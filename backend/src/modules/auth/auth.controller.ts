import { Controller, Post, Get, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { RegisterDto, LoginDto } from "./dto/auth.dto";
import { User } from "./user.entity";
import { JwtAuthGuard } from "./guards/auth.guards";

@ApiTags("认证管理")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  async register(
    @Body() dto: RegisterDto,
  ): Promise<{ user: User; token: string }> {
    return this.authService.register(dto);
  }

  @Post("login")
  async login(@Body() dto: LoginDto): Promise<{ user: User; token: string }> {
    return this.authService.login(dto);
  }

  @Get("users")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async findAll(): Promise<User[]> {
    return this.authService.findAll();
  }
}
