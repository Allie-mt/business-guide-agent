import {
  IsString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsEmail,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RegisterDto {
  @ApiProperty({ description: "用户名" })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ description: "密码" })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ description: "邮箱", required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    description: "角色",
    enum: ["admin", "editor", "viewer"],
    required: false,
  })
  @IsOptional()
  @IsEnum(["admin", "editor", "viewer"])
  role?: "admin" | "editor" | "viewer";
}

export class LoginDto {
  @ApiProperty({ description: "用户名" })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ description: "密码" })
  @IsString()
  @IsNotEmpty()
  password: string;
}
