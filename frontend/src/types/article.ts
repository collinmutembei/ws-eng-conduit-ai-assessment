import { array, boolean, Decoder, nullable, number, object, string } from 'decoders';
import { Profile, profileDecoder } from './profile';
import { User } from './user';

export interface Article {
  slug: string;
  title: string;
  description: string;
  body: string;
  tagList: string[];
  createdAt: string;
  updatedAt: string;
  favorited: boolean;
  favoritesCount: number;
  author: Profile;
  coAuthors: Profile[];
  lockedBy: Profile | null;
  lockedAt: string | null;
  lastPingAt: string | null;
}

export const articleDecoder: Decoder<Article> = object({
  slug: string,
  title: string,
  description: string,
  body: string,
  tagList: array(string),
  createdAt: string,
  updatedAt: string,
  favorited: boolean,
  favoritesCount: number,
  author: profileDecoder,
  coAuthors: array(profileDecoder),
  lockedBy: nullable(profileDecoder),
  lockedAt: nullable(string),
  lastPingAt: nullable(string),
});

export interface MultipleArticles {
  articles: Article[];
  articlesCount: number;
}

export const multipleArticlesDecoder: Decoder<MultipleArticles> = object({
  articles: array(articleDecoder),
  articlesCount: number,
});

export interface ArticleForEditor {
  title: string;
  description: string;
  body: string;
  tagList: string[];
  coAuthors?: string[];
}

export interface ArticlesFilters {
  tag?: string;
  author?: string;
  favorited?: string;
  limit?: number;
  offset?: number;
}

export interface FeedFilters {
  limit?: number;
  offset?: number;
}

export function canEditArticle(article: Article, user: Pick<User, 'username'> | null): boolean {
  if (!user) {
    return false;
  }

  return (
    article.author.username === user.username ||
    article.coAuthors.some((coAuthor) => coAuthor.username === user.username)
  );
}
