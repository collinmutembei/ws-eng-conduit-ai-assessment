import { ArticleDTO } from './article.entity';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';

interface IComment {
  body: string;
}

export interface ICommentsRO {
  comments: IComment[];
}

export interface ICreateArticle {
  article: CreateArticleDto;
}

export interface IUpdateArticle {
  article: UpdateArticleDto;
}

export interface IArticleRO {
  article: ArticleDTO;
}

export interface IArticlesRO {
  articles: ArticleDTO[];
  articlesCount: number;
}
