import { IsDateString, IsIn, IsString, IsUUID, Length, Matches } from 'class-validator'
import { Transform } from 'class-transformer'

export class OrganizationInput {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 120)
  name!: string

  @IsIn(['university', 'school', 'company'])
  kind!: string
}

export class TeamInput {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 120)
  name!: string
}

export class ProjectInput extends TeamInput {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startsOn!: string

  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endsOn!: string

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 120)
  teamName!: string
}

export class JoinInput {
  @IsUUID() teamId!: string
}
