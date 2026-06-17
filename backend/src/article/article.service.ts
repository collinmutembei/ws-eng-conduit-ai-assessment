import { EntityManager, QueryOrder, wrap } from '@mikro-orm/core';
import { EntityRepository } from '@mikro-orm/mysql';
import { InjectRepository } from '@mikro-orm/nestjs';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';

import { User } from '../user/user.entity';
import { Article } from './article.entity';
import { IArticleRO, IArticlesRO, ICommentsRO } from './article.interface';
import { Comment } from './comment.entity';
import { CreateArticleDto, CreateCommentDto, UpdateArticleDto } from './dto';

const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const ARTICLE_RELATIONS = ['author', 'coAuthors', 'lockedBy'] as const;

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
    const articles = await this.articleRepository.find({ id: { $in: ids } }, { populate: ARTICLE_RELATIONS });

    return { articles: articles.map((a) => a.toJSON(user!)), articlesCount };
  }

  async findFeed(userId: number, query: Record<string, string>): Promise<IArticlesRO> {
    const user = userId
      ? await this.userRepository.findOne(userId, { populate: ['followers', 'favorites'] })
      : undefined;
    const res = await this.articleRepository.findAndCount(
      { author: { followers: userId } },
      {
        populate: ARTICLE_RELATIONS,
        orderBy: { createdAt: QueryOrder.DESC },
        limit: +query.limit,
        offset: +query.offset,
      },
    );

    return { articles: res[0].map((a) => a.toJSON(user!)), articlesCount: res[1] };
  }

  async findOne(userId: number, where: Partial<Article>): Promise<IArticleRO> {
    const user = userId
      ? await this.userRepository.findOneOrFail(userId, { populate: ['followers', 'favorites'] })
      : undefined;
    const article = await this.articleRepository.findOne(where, { populate: ARTICLE_RELATIONS });
    return { article: article && article.toJSON(user) } as IArticleRO;
  }

  async addComment(userId: number, slug: string, dto: CreateCommentDto) {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ARTICLE_RELATIONS });
    const author = await this.userRepository.findOneOrFail(userId);
    const comment = new Comment(author, article, dto.body);
    await this.em.persistAndFlush(comment);

    return { comment, article: article.toJSON(author) };
  }

  async deleteComment(userId: number, slug: string, id: number): Promise<IArticleRO> {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ARTICLE_RELATIONS });
    const user = await this.userRepository.findOneOrFail(userId);
    const comment = this.commentRepository.getReference(id);

    if (article.comments.contains(comment)) {
      article.comments.remove(comment);
      await this.em.removeAndFlush(comment);
    }

    return { article: article.toJSON(user) };
  }

  async favorite(id: number, slug: string): Promise<IArticleRO> {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ARTICLE_RELATIONS });
    const user = await this.userRepository.findOneOrFail(id, { populate: ['favorites', 'followers'] });

    if (!user.favorites.contains(article)) {
      user.favorites.add(article);
      article.favoritesCount++;
    }

    await this.em.flush();
    return { article: article.toJSON(user) };
  }

  async unFavorite(id: number, slug: string): Promise<IArticleRO> {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ARTICLE_RELATIONS });
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
    const user = await this.userRepository.findOneOrFail(
      { id: userId },
      { populate: ['followers', 'favorites', 'articles'] },
    );
    const article = new Article(user, dto.title, dto.description, dto.body);
    article.tagList.push(...(dto.tagList ?? []));
    article.coAuthors.set(await this.resolveCoAuthors(dto.coAuthors, user.id));
    user.articles.add(article);
    await this.em.persistAndFlush(article);

    return { article: article.toJSON(user) };
  }

  async update(userId: number, slug: string, articleData: CreateArticleDto | UpdateArticleDto): Promise<IArticleRO> {
    const user = await this.userRepository.findOneOrFail(
      { id: userId },
      { populate: ['followers', 'favorites', 'articles'] },
    );
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ARTICLE_RELATIONS });

    this.ensureCanEditArticle(userId, article);
    this.ensureUserHoldsValidLock(userId, article);

    const { coAuthors, ...updateData } = articleData;
    wrap(article).assign(updateData);

    if (coAuthors !== undefined) {
      article.coAuthors.set(await this.resolveCoAuthors(coAuthors, article.author.id));
    }

    await this.em.flush();

    return { article: article.toJSON(user) };
  }

  async lock(userId: number, slug: string): Promise<IArticleRO> {
    const user = await this.userRepository.findOneOrFail(userId, { populate: ['followers', 'favorites'] });
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ARTICLE_RELATIONS });

    this.ensureCanEditArticle(userId, article);

    if (article.lockedBy && article.lockedBy.id !== userId && !this.isLockExpired(article)) {
      throw new ConflictException('Article is currently locked by another user.');
    }

    const now = new Date();
    article.lockedBy = user;
    article.lockedAt = now;
    article.lastPingAt = now;

    await this.em.flush();

    return { article: article.toJSON(user) };
  }

  async unlock(userId: number, slug: string): Promise<IArticleRO> {
    const user = await this.userRepository.findOneOrFail(userId, { populate: ['followers', 'favorites'] });
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ARTICLE_RELATIONS });

    this.ensureCanEditArticle(userId, article);

    if (article.lockedBy && article.lockedBy.id !== userId && !this.isLockExpired(article)) {
      throw new ConflictException('Article lock is held by another user.');
    }

    this.clearLock(article);
    await this.em.flush();

    return { article: article.toJSON(user) };
  }

  async pingLock(userId: number, slug: string): Promise<IArticleRO> {
    const user = await this.userRepository.findOneOrFail(userId, { populate: ['followers', 'favorites'] });
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ARTICLE_RELATIONS });

    this.ensureCanEditArticle(userId, article);

    if (!article.lockedBy || article.lockedBy.id !== userId) {
      throw new ConflictException('Article lock is held by another user.');
    }

    if (this.isLockExpired(article)) {
      throw new ConflictException('Your article lock has expired.');
    }

    article.lastPingAt = new Date();
    await this.em.flush();

    return { article: article.toJSON(user) };
  }

  async delete(userId: number, slug: string) {
    const article = await this.articleRepository.findOneOrFail({ slug }, { populate: ARTICLE_RELATIONS });

    this.ensureCanEditArticle(userId, article);

    await this.em.removeAndFlush(article);

    return 1;
  }

  private async resolveCoAuthors(coAuthors: string[] | undefined, authorId: number): Promise<User[]> {
    if (!coAuthors) {
      return [];
    }

    const normalizedIdentifiers = [...new Set(coAuthors.map((value) => value.trim()).filter(Boolean))];

    if (normalizedIdentifiers.length === 0) {
      return [];
    }

    const matchingUsers = await this.userRepository.find({
      $or: [{ username: { $in: normalizedIdentifiers } }, { email: { $in: normalizedIdentifiers } }],
    });

    const usersByIdentifier = new Map<string, User>();

    for (const user of matchingUsers) {
      usersByIdentifier.set(user.username.toLowerCase(), user);
      usersByIdentifier.set(user.email.toLowerCase(), user);
    }

    const missingIdentifiers = normalizedIdentifiers.filter(
      (identifier) => !usersByIdentifier.has(identifier.toLowerCase()),
    );

    if (missingIdentifiers.length > 0) {
      throw new BadRequestException({
        message: 'Input data validation failed',
        errors: { coAuthors: `Users not found: ${missingIdentifiers.join(', ')}` },
      });
    }

    const seenUserIds = new Set<number>();
    const resolvedUsers: User[] = [];

    for (const identifier of normalizedIdentifiers) {
      const matchedUser = usersByIdentifier.get(identifier.toLowerCase());

      if (!matchedUser || matchedUser.id === authorId || seenUserIds.has(matchedUser.id)) {
        continue;
      }

      seenUserIds.add(matchedUser.id);
      resolvedUsers.push(matchedUser);
    }

    return resolvedUsers;
  }

  private ensureCanEditArticle(userId: number, article: Article): void {
    const isAuthor = article.author.id === userId;
    const isCoAuthor = article.coAuthors.getItems().some((coAuthor) => coAuthor.id === userId);

    if (!isAuthor && !isCoAuthor) {
      throw new ForbiddenException('You are not allowed to edit this article.');
    }
  }

  private ensureUserHoldsValidLock(userId: number, article: Article): void {
    if (article.lockedBy?.id === userId && !this.isLockExpired(article)) {
      return;
    }

    if (article.lockedBy && article.lockedBy.id !== userId && !this.isLockExpired(article)) {
      throw new ConflictException('Article is currently locked by another user.');
    }

    throw new ConflictException('You do not hold a valid lock for this article.');
  }

  private isLockExpired(article: Article): boolean {
    if (!article.lockedBy) {
      return true;
    }

    const lockTimestamp = article.lastPingAt ?? article.lockedAt;

    if (!lockTimestamp) {
      return true;
    }

    return Date.now() - lockTimestamp.getTime() >= LOCK_TIMEOUT_MS;
  }

  private clearLock(article: Article): void {
    article.lockedBy = undefined;
    article.lockedAt = undefined;
    article.lastPingAt = undefined;
  }
}
