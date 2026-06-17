import { EntityManager, QueryOrder } from '@mikro-orm/core';
import { EntityRepository } from '@mikro-orm/mysql';
import { InjectRepository } from '@mikro-orm/nestjs';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import { User } from '../user/user.entity';
import { Article } from './article.entity';
import { IArticleRO, IArticlesRO, ICommentsRO } from './article.interface';
import { Comment } from './comment.entity';
import { CreateArticleDto, CreateCommentDto } from './dto';

@Injectable()
export class ArticleService {
  constructor(
    private readonly em: EntityManager,
    @InjectRepository(Article)
    private readonly articleRepository: EntityRepository<Article>,
    @InjectRepository(Comment)
    private readonly commentRepository: EntityRepository<Comment>,
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
  ) {}

  async findAll(userId: number, query: Record<string, string>): Promise<IArticlesRO> {
    const user = userId
      ? await this.userRepository.findOne(userId, { populate: ['followers', 'favorites'] })
      : undefined;
    const qb = this.articleRepository.createQueryBuilder('a').select('a.*').leftJoin('a.author', 'u');

    if ('tag' in query) {
      qb.andWhere({ tagList: new RegExp(query.tag) });
    }

    if ('author' in query) {
      const author = await this.userRepository.findOne({ username: query.author });

      if (!author) {
        return { articles: [], articlesCount: 0 };
      }

      qb.andWhere({ author: author.id });
    }

    if ('favorited' in query) {
      const author = await this.userRepository.findOne({ username: query.favorited }, { populate: ['favorites'] });

      if (!author) {
        return { articles: [], articlesCount: 0 };
      }

      const ids = author.favorites.$.getIdentifiers();
      qb.andWhere({ author: ids });
    }

    qb.orderBy({ createdAt: QueryOrder.DESC });
    const res = await qb.clone().count('id', true).execute('get');
    const articlesCount = res.count;

    if ('limit' in query) {
      qb.limit(+query.limit);
    }

    if ('offset' in query) {
      qb.offset(+query.offset);
    }

    const ids = (await qb.getResult()).map((a) => a.id);
    const articles = await this.articleRepository.find({ id: { $in: ids } }, { populate: ['author', 'coAuthors'] });
    return { articles: articles.map((a) => a.toJSON(user!)), articlesCount };
  }

  async findFeed(userId: number, query: Record<string, string>): Promise<IArticlesRO> {
    const user = userId
      ? await this.userRepository.findOne(userId, { populate: ['followers', 'favorites'] })
      : undefined;
    const res = await this.articleRepository.findAndCount(
      { author: { followers: userId } },
      {
        populate: ['author', 'coAuthors'],
        orderBy: { createdAt: QueryOrder.DESC },
        limit: +query.limit,
        offset: +query.offset,
      },
    );

    console.log('findFeed', { articles: res[0], articlesCount: res[1] });
    return { articles: res[0].map((a) => a.toJSON(user!)), articlesCount: res[1] };
  }

  async findOne(userId: number, where: Partial<Article>): Promise<IArticleRO> {
    const user = userId
      ? await this.userRepository.findOneOrFail(userId, { populate: ['followers', 'favorites'] })
      : undefined;
    const article = await this.articleRepository.findOne(where, { populate: ['author', 'coAuthors'] });
    return { article: article && article.toJSON(user) } as IArticleRO;
  }

  async addComment(userId: number, slug: string, dto: CreateCommentDto) {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['author', 'coAuthors'] });
    const author = await this.userRepository.findOneOrFail(userId);
    const comment = new Comment(author, article, dto.body);
    await this.em.persistAndFlush(comment);

    return { comment, article: article.toJSON(author) };
  }

  async deleteComment(userId: number, slug: string, id: number): Promise<IArticleRO> {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['author', 'coAuthors'] });
    const user = await this.userRepository.findOneOrFail(userId);
    const comment = this.commentRepository.getReference(id);

    if (article.comments.contains(comment)) {
      article.comments.remove(comment);
      await this.em.removeAndFlush(comment);
    }

    return { article: article.toJSON(user) };
  }

  async favorite(id: number, slug: string): Promise<IArticleRO> {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['author', 'coAuthors'] });
    const user = await this.userRepository.findOneOrFail(id, { populate: ['favorites', 'followers'] });

    if (!user.favorites.contains(article)) {
      user.favorites.add(article);
      article.favoritesCount++;
    }

    await this.em.flush();
    return { article: article.toJSON(user) };
  }

  async unFavorite(id: number, slug: string): Promise<IArticleRO> {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['author', 'coAuthors'] });
    const user = await this.userRepository.findOneOrFail(id, { populate: ['followers', 'favorites'] });

    if (user.favorites.contains(article)) {
      user.favorites.remove(article);
      article.favoritesCount--;
    }

    await this.em.flush();
    return { article: article.toJSON(user) };
  }

  async findComments(slug: string): Promise<ICommentsRO> {
    const article = await this.articleRepository.findOne({ slug }, { populate: ['comments'] });
    return { comments: article!.comments.getItems() };
  }

  async create(userId: number, dto: CreateArticleDto) {
    const user = await this.userRepository.findOne(
      { id: userId },
      { populate: ['followers', 'favorites', 'articles'] },
    );
    const article = new Article(user!, dto.title, dto.description, dto.body);
    article.tagList = dto.tagList ?? [];
    for (const coAuthor of await this.resolveCoAuthors(dto.coAuthors, user!)) {
      article.coAuthors.add(coAuthor);
    }
    user?.articles.add(article);
    await this.em.persistAndFlush(article);

    return { article: article.toJSON(user!) };
  }

  async update(userId: number, slug: string, articleData: CreateArticleDto): Promise<IArticleRO> {
    const user = await this.userRepository.findOne(
      { id: userId },
      { populate: ['followers', 'favorites', 'articles'] },
    );
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['author', 'coAuthors'] });

    this.assertCanEdit(article, userId);

    article.title = articleData.title;
    article.description = articleData.description;
    article.body = articleData.body;
    article.tagList = articleData.tagList ?? [];
    article.coAuthors.removeAll();
    for (const coAuthor of await this.resolveCoAuthors(articleData.coAuthors, article.author)) {
      article.coAuthors.add(coAuthor);
    }

    await this.em.flush();

    return { article: article.toJSON(user!) };
  }

  async delete(userId: number, slug: string) {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ['author', 'coAuthors'] });

    this.assertCanEdit(article, userId);

    return this.articleRepository.nativeDelete({ slug });
  }

  private assertCanEdit(article: Article, userId: number) {
    if (article.author.id === userId || article.coAuthors.getItems().some((coAuthor) => coAuthor.id === userId)) {
      return;
    }

    throw new ForbiddenException({ errors: { article: ['You are not allowed to edit this article'] } });
  }

  private async resolveCoAuthors(usernames: string[] | undefined, author: User): Promise<User[]> {
    const coAuthorUsernames = [...new Set((usernames ?? []).map((username) => username.trim()).filter(Boolean))].filter(
      (username) => username.toLowerCase() !== author.username.toLowerCase(),
    );

    if (coAuthorUsernames.length === 0) {
      return [];
    }

    const coAuthors = await this.userRepository.find({ username: { $in: coAuthorUsernames } });
    const foundUsernames = new Set(coAuthors.map((coAuthor) => coAuthor.username.toLowerCase()));
    const missingUsernames = coAuthorUsernames.filter((username) => !foundUsernames.has(username.toLowerCase()));

    if (missingUsernames.length > 0) {
      throw new BadRequestException({
        errors: { coAuthors: missingUsernames.map((username) => `Unknown username: ${username}`) },
      });
    }

    return coAuthors;
  }
}
