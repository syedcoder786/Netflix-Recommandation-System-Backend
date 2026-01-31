function extractBaseTitle(query: string): string {
return query
.replace(/movies like|similar to|recommend|me|some/gi, '')
.trim();
}

async resolveBaseMovie(rawQuery: string) {
const baseQuery = extractBaseTitle(rawQuery).toLowerCase();

const candidates = await this.movieRepository.query(
`     SELECT id, title, genres, popularity, embedding,
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

async getSimilarMovies(query: string) {
const baseMovie = await this.resolveBaseMovie(query);

if (!baseMovie?.embedding) {
return [];
}

return this.movieRepository.query(
`     SELECT id, title, genres, popularity,
           1 - (embedding <=> $1) AS similarity
    FROM movies
    WHERE embedding IS NOT NULL
      AND id != $2
      AND genres && $3
    ORDER BY embedding <=> $1
    LIMIT 20
    `,
[baseMovie.embedding, baseMovie.id, baseMovie.genres],
);
}
