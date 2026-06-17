import {
  ArrayType,
  Collection,
  Entity,
  EntityDTO,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
  wrap,
} from '@mikro-orm/core';
import slug from 'slug';

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

  @ManyToMany({
    entity: () => User,
    owner: true,
    pivotTable: 'article_co_authors',
    joinColumn: 'article_id',
    inverseJoinColumn: 'user_id',
  })
  coAuthors = new Collection<User>(this);

  @ManyToOne(() => User, { nullable: true, fieldName: 'locked_by_id' })
  lockedBy?: User | null = null;

  @Property({ type: 'date', nullable: true, fieldName: 'locked_at' })
  lockedAt?: Date | null = null;

  @Property({ type: 'date', nullable: true, fieldName: 'last_ping_at' })
  lastPingAt?: Date | null = null;

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
    const article = {
      ...(wrap<Article>(this).toObject() as EntityDTO<Article>),
    } as EntityDTO<Article> & {
      lockedBy?: EntityDTO<User> | null;
      lockedAt?: Date | null;
      lastPingAt?: Date | null;
    };

    delete article.lockedBy;
    delete article.lockedAt;
    delete article.lastPingAt;

    const result = article as unknown as ArticleDTO;
    result.favorited = user && user.favorites.isInitialized() ? user.favorites.contains(this) : false;
    result.author = this.author.toJSON(user);
    result.coAuthors = this.coAuthors.isInitialized()
      ? this.coAuthors.getItems().map((coAuthor) => coAuthor.username)
      : [];

    return result;
  }
}

export interface ArticleDTO extends Omit<EntityDTO<Article>, 'coAuthors' | 'lockedBy' | 'lockedAt' | 'lastPingAt'> {
  favorited?: boolean;
  coAuthors?: string[];
}
