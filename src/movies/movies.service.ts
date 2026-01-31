import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import csv from 'csv-parser';
import { Movie } from './movie.entity';
import { pipeline } from '@xenova/transformers';

@Injectable()
export class MoviesService {
  private extractor: any;

  constructor(
    @InjectRepository(Movie)
    private readonly movieRepository: Repository<Movie>,
  ) {}

  private async initExtractor() {
    if (!this.extractor) {
      this.extractor = await pipeline(
        'feature-extraction',
        'Xenova/all-mpnet-base-v2',
      );
    }
  }

  private async embedText(text: string): Promise<string> {
    await this.initExtractor();
    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: true,
    });
    // Convert to array and then to PostgreSQL vector format string
    const array = Array.from(output.data);
    return `[${array.join(',')}]`;
  }

  // ---------- UTILS ----------
  private toNumber(value: string): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return isNaN(n) ? null : n;
  }

  private toBoolean(value: string): boolean | null {
    if (!value) return null;
    return value.toLowerCase() === 'true';
  }

  private toDate(value: string): string | null {
    if (!value) return null;
    try {
      // Try parsing different date formats
      // Format 1: YYYY-MM-DD
      if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return value;
      }
      // Format 2: DD-MM-YYYY or DD/MM/YYYY
      const parts = value.split(/[-\/]/);
      if (parts.length === 3) {
        const [d, m, y] = parts;
        return `${y}-${m}-${d}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  private split(value?: string): string[] {
    return value ? value.split(',').map((v) => v.trim()) : [];
  }

  private readonly GENRE_KEYWORDS = {
    action: 'Action',
    anime: 'animation',
    adventure: 'Adventure',
    scifi: 'ScienceFiction',
    sciencefiction: 'Science Fiction',
    thriller: 'Thriller',
    crime: 'Crime',
    drama: 'Drama',
    romance: 'Romance',
    comedy: 'Comedy',
    horror: 'Horror',
    fantasy: 'Fantasy',
    mystery: 'Mystery',
    animation: 'Animation',
    family: 'Family',
    war: 'War',
    western: 'Western',
    history: 'History',
    music: 'Music',
  };

  // ---------- SEED MOVIES FROM CSV ----------
  async seedMovies(csvPath: string, limit, startIndex): Promise<void> {
    if (!fs.existsSync(csvPath)) {
      throw new Error(`CSV file not found at: ${csvPath}`);
    }

    let count = 0;
    let rowIndex = 0;

    const stream = fs.createReadStream(csvPath).pipe(csv());

    for await (const row of stream) {
      // Skip rows before startIndex
      if (rowIndex < startIndex) {
        rowIndex++;
        continue;
      }

      if (count >= limit) break;

      const genres = this.split(row.genres);
      const companies = this.split(row.production_companies);
      const keywords = this.split(row.keywords);

      const embeddingText = `
        Title: ${row.title}
        Overview: ${row.overview}
        Genres: ${genres.join(' ')}
        Production Companies: ${companies.join(' ')}
        Keywords: ${keywords.join(' ')}
      `;

      const vector = await this.embedText(embeddingText);

      const movie = this.movieRepository.create({
        title: row.title,

        vote_average: this.toNumber(row.vote_average),
        vote_count: this.toNumber(row.vote_count),

        status: row.status || null,
        release_date: this.toDate(row.release_date),

        revenue: this.toNumber(row.revenue),
        runtime: this.toNumber(row.runtime),
        adult: this.toBoolean(row.adult),

        backdrop_path: row.backdrop_path || null,
        budget: this.toNumber(row.budget),
        homepage: row.homepage || null,

        imdb_id: row.imdb_id || null,
        original_language: row.original_language || null,
        original_title: row.original_title || null,

        overview: row.overview || null,
        popularity: this.toNumber(row.popularity),
        poster_path: row.poster_path || null,
        tagline: row.tagline || null,

        genres,
        production_companies: companies,
        production_countries: this.split(row.production_countries),
        spoken_languages: this.split(row.spoken_languages),
        keywords,

        embedding: vector,
      } as any);

      await this.movieRepository.save(movie);
      count++;
      rowIndex++;

      if (count % 50 === 0) {
        console.log(`Inserted ${count} movies`);
      }
    }

    console.log(
      `✅ Done: Inserted ${count} movies (starting from index ${startIndex})`,
    );
  }

  private extractGenresFromQuery(query: string): string[] {
    const lowerQuery = query.toLowerCase();
    const foundGenres: string[] = [];

    for (const [key, value] of Object.entries(this.GENRE_KEYWORDS)) {
      if (
        lowerQuery.includes(key) ||
        lowerQuery.includes(value.toLowerCase())
      ) {
        foundGenres.push(value);
      }
    }

    return foundGenres;
  }

  private extractBaseTitle(query: string): string {
    return query
      .replace(
        /movies?\s+(like|similar\s+to|recommend)|similar\s+(like|to)|recommend|me|some/gi,
        '',
      )
      .trim();
  }

  private async getSimilarMovie(rawQuery: string) {
    const baseQuery = this.extractBaseTitle(rawQuery).toLowerCase();

    const candidates = await this.movieRepository.query(
      `
    SELECT id, title, genres, popularity, embedding,
           word_similarity(lower(title), $1) AS sim
    FROM movies
    WHERE word_similarity(lower(title), $1) > 0.25
    ORDER BY sim DESC, popularity DESC
    LIMIT 5
    `,
      [baseQuery],
    );

    return candidates[0]; // best fuzzy + popularity match
  }

  // ---------- SEARCH MOVIES ----------
  async search(query: string) {
    const results = new Map<number, any>();

    if (query.length === 0) {
      query = 'top action';
    }

    // Check for "movies similar to ..." pattern and top high-rated movies
    let similarMovieFound = false;
    if (query.length >= 8) {
      const baseMovie = await this.getSimilarMovie(query);

      if (baseMovie && baseMovie.embedding) {
        console.log('similar triggerd');
        similarMovieFound = true;

        const similarMatches = await this.movieRepository.query(
          `
          SELECT *,
                 1 - (embedding <=> $1) AS similarity
          FROM movies
          WHERE embedding IS NOT NULL
            AND id != $2
            AND genres && $3
          ORDER BY embedding <=> $1
          LIMIT 50
          `,
          [baseMovie.embedding, baseMovie.id, baseMovie.genres],
        );

        similarMatches.forEach((m: any) => {
          if (!results.has(m.id)) {
            results.set(m.id, { ...m, rank: 1.0 });
          }
        });
      }

      const isGenericQuery =
        /(best|top|popular|trending|high rated|must watch)/i.test(query);

      // ⭐ 4️⃣ Top high-rated & popular movies (QUALITY BOOST)
      if (isGenericQuery) {
        console.log('generic triggerd');
        similarMovieFound = true;
        const topRatedResults = await this.movieRepository.query(
          `
            SELECT *,
                (
                    (vote_average * LN(vote_count + 1)) +
                    (popularity * 0.5)
                ) AS quality_score
            FROM movies
            WHERE vote_count > 500
            AND vote_average >= 7.5
            ORDER BY quality_score DESC
            LIMIT 50
            `,
        );

        topRatedResults.forEach((m: any) => {
          if (results.has(m.id)) {
            // boost existing result
            results.get(m.id).rank += 1.2;
          } else {
            // fallback discovery
            results.set(m.id, {
              ...m,
              rank: 1.1,
            });
          }
        });
      }
    }

    // 1️⃣ Fuzzy / Autocomplete search (FAST)
    // Only if no similar/generic movie search was done
    // If query is short < 3, we want more fuzzy results only
    if (!similarMovieFound) {
      console.log('fuzzy triggerd');
      const limit = query.length < 3 ? 50 : 20; // more results for very short queries
      const fuzzyResults = await this.movieRepository.query(
        `
        SELECT *,
            GREATEST(
              word_similarity(lower(title), lower($1)),
              word_similarity(lower(overview), lower($1)),
              word_similarity(lower(tagline), lower($1))
            ) AS score
      FROM movies
      WHERE GREATEST(
              word_similarity(lower(title), lower($1)),
              word_similarity(lower(overview), lower($1)),
              word_similarity(lower(tagline), lower($1))
            ) > 0.25
      ORDER BY score DESC
      LIMIT $2;
        `,
        [query, limit],
      );

      fuzzyResults.forEach((m: any) => {
        if (!results.has(m.id)) {
          results.set(m.id, { ...m, rank: 1.0 });
        }
      });
    }

    if (query.length >= 5) {
      // Extract genres from query if length >= 5
      let foundGenres: string[] = [];
      foundGenres = this.extractGenresFromQuery(query);

      // Add genre-based results if genres found
      if (foundGenres.length > 0) {
        console.log('genre triggerd');
        const genreResults = await this.movieRepository.query(
          `
        SELECT *
        FROM movies
        WHERE genres && $1
        ORDER BY popularity DESC
        LIMIT 50
        `,
          [foundGenres],
        );

        genreResults.forEach((m: any) => {
          if (!results.has(m.id)) {
            results.set(m.id, { ...m, rank: 0.9 });
          }
        });
      }
    }

    // 2️⃣ Semantic vector search (ONLY if query is meaningful)
    // Added to every query result set with length >= 3
    // if (query.length >= 3) {
    //   const queryVector = await this.embedText(query);

    //   const vectorResults = await this.movieRepository.query(
    //     `
    //     SELECT *,
    //            1 - (embedding <=> $1) AS similarity
    //     FROM movies
    //     ORDER BY similarity DESC
    //     LIMIT 10
    //     `,
    //     [queryVector],
    //   );

    //   vectorResults.forEach((m: any) => {
    //     if (results.has(m.id)) {
    //       results.get(m.id).rank += 1.0;
    //     } else {
    //       results.set(m.id, { ...m, rank: 0.9 });
    //     }
    //   });
    // }

    // 3️⃣ Sort by combined rank + popularity
    return Array.from(results.values())
      .map(({ embedding, ...rest }) => rest) // 👈 removes embedding
      .sort(
        (a, b) =>
          b.rank +
          (b.popularity || 0) * 0.01 +
          (b.vote_average || 0) * 0.2 +
          Math.log((b.vote_count || 1) + 1) * 0.15 -
          (a.rank +
            (a.popularity || 0) * 0.01 +
            (a.vote_average || 0) * 0.2 +
            Math.log((a.vote_count || 1) + 1) * 0.15),
      )
      .slice(0, 54);
  }

  async popularGenreSearch(genres: string[]) {
    if (!genres.length) return [];

    // 1️⃣ Pull a BIG candidate pool
    const results = await this.movieRepository.query(
      `
    SELECT *
    FROM movies
    WHERE EXISTS (
      SELECT 1
      FROM unnest(genres) g
      WHERE lower(g) = ANY($1)
    )
    AND popularity IS NOT NULL
    ORDER BY popularity DESC
    LIMIT 300
    `,
      [genres.map((g) => g.toLowerCase())],
    );

    // 2️⃣ Strong randomized ranking
    const randomized = results.map((movie: any) => {
      const popularityScore = Math.log((movie.popularity || 1) + 1);
      const ratingScore = (movie.vote_average || 5) / 2; // normalize
      const votesScore = Math.log((movie.vote_count || 1) + 1);

      // 🔥 MUCH stronger randomness
      const randomBoost = Math.random() * 15;

      return {
        ...movie,
        _score:
          popularityScore * 2 + ratingScore * 2 + votesScore * 1 + randomBoost,
      };
    });

    // 3️⃣ Sort by noisy score
    randomized.sort((a, b) => b._score - a._score);

    // 4️⃣ Soft shuffle the top results
    const top = randomized.slice(0, 50);
    for (let i = top.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [top[i], top[j]] = [top[j], top[i]];
    }

    // 5️⃣ Return final list
    return top.slice(0, 30).map(({ embedding, _score, ...movie }) => movie);
  }

  async getTrendingMovies(limit: number) {
    // 1️⃣ Fetch more movies to allow randomness
    const results = await this.movieRepository.query(
      `
    SELECT *
    FROM movies
    WHERE popularity IS NOT NULL
      AND release_date IS NOT NULL
    ORDER BY popularity DESC
    LIMIT $1
    `,
      [limit * 5], // fetch extra
    );

    // 2️⃣ Tier-based shuffle
    const topTier = results.slice(0, limit * 2); // very popular
    const midTier = results.slice(limit * 2, limit * 4); // mid popularity
    const lowTier = results.slice(limit * 4); // less popular

    const shuffle = (arr: any[]) => arr.sort(() => Math.random() - 0.5);

    // 3️⃣ Pick from each tier (weighted)
    const picked = [
      ...shuffle(topTier).slice(0, Math.ceil(limit * 0.5)), // 50% from top
      ...shuffle(midTier).slice(0, Math.ceil(limit * 0.35)), // 35% from mid
      ...shuffle(lowTier).slice(0, Math.ceil(limit * 0.15)), // 15% from low
    ];

    // 4️⃣ Final shuffle so order feels random
    const final = shuffle(picked).slice(0, limit);

    // 5️⃣ Clean helper fields
    return final.map(({ trend_score, embedding, _score, ...movie }) => movie);
  }

  async getMoviesLikeThis(movieId: number, page: number, limit: number) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const offset = (safePage - 1) * safeLimit;

    // 1️⃣ Get base movie embedding
    const [baseMovie] = await this.movieRepository.query(
      `
    SELECT embedding
    FROM movies
    WHERE id = $1
      AND embedding IS NOT NULL
    `,
      [movieId],
    );

    if (!baseMovie?.embedding) {
      return {
        page: safePage,
        limit: safeLimit,
        total: 0,
        data: [],
      };
    }

    // 2️⃣ Vector similarity search with pagination
    const results = await this.movieRepository.query(
      `
    SELECT
      *,
      1 - (embedding <=> $1) AS similarity_score
    FROM movies
    WHERE embedding IS NOT NULL
      AND id != $2
    ORDER BY embedding <=> $1
    OFFSET $3
    LIMIT $4
    `,
      [baseMovie.embedding, movieId, offset, safeLimit],
    );

    return {
      page: safePage,
      limit: safeLimit,
      total: 90,
      data: results.map(
        ({ embedding, _score, similarity_score, ...movie }) => ({
          ...movie,
          similarity_score,
        }),
      ),
    };
  }
}
