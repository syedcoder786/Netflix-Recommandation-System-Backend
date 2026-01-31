import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { MoviesService } from './movies.service';

@Controller('movies')
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  @Get('search')
  async searchMovies(@Query('q') query: string) {
    try {
      const results = await this.moviesService.search(query);
      return results;
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Example:
   * /movies/genre/popular?genre=action
   * /movies/genre/popular?genre=action,thriller
   */
  @Get('genre/popular')
  async searchPopularByGenre(@Query('genre') genre: string) {
    if (!genre) {
      return { error: 'genre query parameter is required' };
    }

    const genres = genre
      .split(',')
      .map((g) => g.trim().toLowerCase())
      .filter(Boolean);

    return this.moviesService.popularGenreSearch(genres);
  }

  @Get('trending')
  async getTrendingMovies(@Query('limit') limit?: string) {
    return this.moviesService.getTrendingMovies(limit ? Number(limit) : 10);
  }

  @Get('moviesLikeThis/:movieId')
  async getMoviesLikeThis(
    @Param('movieId', ParseIntPipe) movieId: number,
    @Query('page') page = 1,
    @Query('limit') limit = 12,
  ) {
    return this.moviesService.getMoviesLikeThis(
      movieId,
      Number(page),
      Number(limit),
    );
  }

  // @Get('seed')
  // async seedMovies() {
  //   try {
  //     const csvPath = 'E:\\movie-app\\src\\TMDB_movie_dataset_v11.csv';
  //     await this.moviesService.seedMovies(csvPath, 11455, 3545);
  //     return { message: 'Seeding completed successfully' };
  //   } catch (error) {
  //     return { error: error.message };
  //   }
  // }
}
