import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'movies' })
export class Movie {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ type: 'float', nullable: true })
  vote_average: number;

  @Column({ type: 'int', nullable: true })
  vote_count: number;

  @Column({ nullable: true })
  status: string;

  @Column({ type: 'date', nullable: true })
  release_date: string;

  @Column({ type: 'bigint', nullable: true })
  revenue: number;

  @Column({ type: 'int', nullable: true })
  runtime: number;

  @Column({ type: 'boolean', nullable: true })
  adult: boolean;

  @Column({ nullable: true })
  backdrop_path: string;

  @Column({ type: 'bigint', nullable: true })
  budget: number;

  @Column({ nullable: true })
  homepage: string;

  @Column({ nullable: true })
  imdb_id: string;

  @Column({ nullable: true })
  original_language: string;

  @Column({ nullable: true })
  original_title: string;

  @Column({ type: 'text', nullable: true })
  overview: string;

  @Column({ type: 'float', nullable: true })
  popularity: number;

  @Column({ nullable: true })
  poster_path: string;

  @Column({ nullable: true })
  tagline: string;

  @Column({ type: 'text', array: true, nullable: true })
  genres: string[];

  @Column({ type: 'text', array: true, nullable: true })
  production_companies: string[];

  @Column({ type: 'text', array: true, nullable: true })
  production_countries: string[];

  @Column({ type: 'text', array: true, nullable: true })
  spoken_languages: string[];

  @Column({ type: 'text', array: true, nullable: true })
  keywords: string[];

  @Column({ type: 'vector', length: 768, nullable: true })
  embedding: number[];
}
