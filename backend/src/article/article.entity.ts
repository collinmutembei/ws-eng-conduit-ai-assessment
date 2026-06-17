import {
  ArrayType,
  Collection,
  Entity,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
  wrap,
} from '@mikro-orm/core';
import slug from 'slug';

import { IProfileData } from '../profile/profile.interface';
import { User } from '../user/user.entity';
import { Comment } from './comment.entity';

@Entity()
export class Article {
  @PrimaryKey({ type: 'number' })
  id: number;

  @Property({ fieldName: 'slug' })
  slug: string;

  @Property({ fieldName: 'title' })
  title: string;

  @Property({ fieldName: 'description' })
  description = '';

  @Property({ fieldName: 'body' })
  body = '';

  @Property({ type: 'date', fieldName: 'created_at' })
  createdAt = new Date();

  @Property({ type: 'date', onUpdate: () => new Date(), fieldName: 'updated_at' })
  updatedAt = new Date();

  @Property({ type: ArrayType, fieldName: 'tag_list' })
  tagList: string[] = [];

  @ManyToOne(() => User, { fieldName: 'author_id' })
  author: User;

  @ManyToMany(() => User, (user) => user.coAuthoredArticles, { owner: true })
  coAuthors = new Collection<User>(this);

  @ManyToOne(() => User, { fieldName: 'locked_by_id', nullable: true })
  lockedBy?: User;

  @Property({ type: 'date', nullable: true, fieldName: 'locked_at' })
  lockedAt?: Date;

  @Property({ type: 'date', nullable: true, fieldName: 'last_ping_at' })
  lastPingAt?: Date;

  @OneToMany(() => Comment, (comment) => comment.article, { eager: true, orphanRemoval: true })
  comments = new Collection<Comment>(this);

  @Property({ type: 'number', fieldName: 'favorites_count' })
  favoritesCount = 0;

  constructor(author: User, title: string, description: string, body: string) {
    this.author = author;
    this.title = title;
    this.description = description;
    this.body = body;
    this.slug = slug(title, { lower: true }) + '-' + ((Math.random() * Math.pow(36, 6)) | 0).toString(36);
  }

  toJSON(user?: User) {
    const o = wrap<Article>(this).toObject() as ArticleDTO;
    o.favorited = user && user.favorites.isInitialized() ? user.favorites.contains(this) : false;
    o.author = this.author.toJSON(user);
    o.coAuthors = this.coAuthors.getItems().map((coAuthor) => coAuthor.toJSON(user));
    o.lockedBy = this.lockedBy ? this.lockedBy.toJSON(user) : null;
    o.lockedAt = this.lockedAt?.toISOString() ?? null;
    o.lastPingAt = this.lastPingAt?.toISOString() ?? null;

    return o;
  }
}

export interface ArticleDTO {
  [key: string]: unknown;
  favorited?: boolean;
  author?: IProfileData;
  coAuthors?: IProfileData[];
  lockedBy?: IProfileData | null;
  lockedAt?: string | null;
  lastPingAt?: string | null;
}
