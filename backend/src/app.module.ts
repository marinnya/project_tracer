import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { OneCModule } from './integrations/oneC/onec.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ScheduleModule.forRoot(), // для cron-задач
    UsersModule,
    AuthModule,
    ProjectsModule,
    OneCModule, // добавили
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}