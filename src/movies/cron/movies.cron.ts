// movies.cron.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MoviesService } from '../movies.service';

@Injectable()
export class MoviesCron {
  constructor(private readonly moviesService: MoviesService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleTrendingRefresh() {
    console.log('Cron started');
    await this.moviesService.getTrendingMovies(1);
  }
}
