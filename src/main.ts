import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((origin) =>
    origin.trim(),
  );

  app.enableCors({
    origin: (origin, callback) => {
      // allow server-to-server / Postman / curl
      if (!origin) return callback(null, true);

      if (allowedOrigins?.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  await app.listen(3000);
}
bootstrap();
