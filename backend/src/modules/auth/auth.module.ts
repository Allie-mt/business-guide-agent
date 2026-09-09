import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./user.entity";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtAuthGuard, RolesGuard } from "./guards/auth.guards";

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET || "default-secret-change-me",
        signOptions: {
          expiresIn: process.env.JWT_EXPIRES_IN || "7d",
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
