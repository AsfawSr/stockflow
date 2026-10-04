import { Transform } from 'class-transformer';
import { IsBoolean, IsString, Matches, MaxLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateWebhookDto {
  @Transform(trimmed)
  @IsString()
  @Matches(/^https?:\/\/\S+$/, {
    message: 'Enter an http(s) URL without spaces.',
  })
  @MaxLength(2048)
  url!: string;
}

export class UpdateWebhookDto {
  @IsBoolean()
  active!: boolean;
}
