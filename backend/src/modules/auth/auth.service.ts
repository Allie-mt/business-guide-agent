import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as crypto from "crypto";
import { User } from "./user.entity";
import { RegisterDto, LoginDto } from "./dto/auth.dto";

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<{ user: User; token: string }> {
    const hashedPassword = this._hashPassword(dto.password);

    const user = this.userRepo.create({
      username: dto.username,
      password: hashedPassword,
      email: dto.email,
      role: dto.role || "viewer",
    });

    const savedUser = await this.userRepo.save(user);
    const token = this._generateToken(savedUser);

    const { password, ...result } = savedUser;
    return { user: result as User, token };
  }

  async login(dto: LoginDto): Promise<{ user: User; token: string }> {
    const user = await this.userRepo.findOneBy({ username: dto.username });
    if (!user) throw new UnauthorizedException("用户名或密码错误");

    const hashedPassword = this._hashPassword(dto.password);
    if (user.password !== hashedPassword) {
      throw new UnauthorizedException("用户名或密码错误");
    }

    if (!user.isActive) {
      throw new UnauthorizedException("用户已被禁用");
    }

    const token = this._generateToken(user);
    const { password, ...result } = user;
    return { user: result as User, token };
  }

  async validateUser(userId: string): Promise<User | null> {
    return this.userRepo.findOneBy({ id: userId });
  }

  async findAll(): Promise<User[]> {
    const users = await this.userRepo.find({ order: { createdAt: "DESC" } });
    return users.map(({ password, ...rest }) => rest as User);
  }

  private _hashPassword(password: string): string {
    return crypto.createHash("sha256").update(password).digest("hex");
  }

  private _generateToken(user: User): string {
    const payload = { sub: user.id, username: user.username, role: user.role };
    return this.jwtService.sign(payload);
  }
}
