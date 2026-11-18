import { Module } from '@nestjs/common'
import { HealthController } from './health.controller'
import { PrismaService } from './prisma.service'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AuthController } from './auth/auth.controller'
import { AuthService } from './auth/auth.service'
import { GitHubClient } from './auth/github.client'
import { SessionGuard } from './auth/session.guard'
import { WorkspaceController } from './workspace/workspace.controller'
import { WorkspaceService } from './workspace/workspace.service'
import { WebhooksController } from './github/webhooks.controller'
import { RepositoriesController } from './github/repositories.controller'
import { GitHubAppClient } from './github/app.client'
import { DeliveryProcessor } from './github/delivery.processor'
import { EventsQueue } from './github/events.queue'

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }])],
  controllers: [HealthController, AuthController, WorkspaceController, WebhooksController, RepositoriesController],
  providers: [PrismaService, AuthService, GitHubClient, WorkspaceService, GitHubAppClient, DeliveryProcessor, EventsQueue,
    { provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
