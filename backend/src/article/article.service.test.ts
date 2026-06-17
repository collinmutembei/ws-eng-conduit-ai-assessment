import assert from 'node:assert/strict';
import test from 'node:test';
import { Collection, EntityManager } from '@mikro-orm/core';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { User } from '../user/user.entity';
import { Article } from './article.entity';
import { ArticleService } from './article.service';
import { CreateArticleDto } from './dto';

type ArticleRepositoryMock = {
  findOneOrFail: (where: unknown, options?: unknown) => Promise<Article>;
  nativeDelete: (where: unknown) => Promise<unknown>;
};

type CommentRepositoryMock = Record<string, never>;

type UserRepositoryMock = {
  findOne: (where: unknown, options?: unknown) => Promise<User | null>;
  find: (where: unknown) => Promise<User[]>;
};

const collectionPrototype = Collection.prototype as unknown as {
  validateItemType: (...args: unknown[]) => void;
  add: (...items: unknown[]) => void;
  removeAll: () => void;
  getItems: () => unknown[];
  isInitialized: () => boolean;
  contains: (item: unknown) => boolean;
};
const articlePrototype = Article.prototype as unknown as {
  toJSON: (user?: User) => unknown;
};

const originalValidateItemType = collectionPrototype.validateItemType;
const originalAdd = collectionPrototype.add;
const originalRemoveAll = collectionPrototype.removeAll;
const originalGetItems = collectionPrototype.getItems;
const originalIsInitialized = collectionPrototype.isInitialized;
const originalContains = collectionPrototype.contains;
const originalToJSON = articlePrototype.toJSON;

collectionPrototype.validateItemType = function validateItemType() {
  return;
};

collectionPrototype.add = function add(...items: unknown[]) {
  const currentItems = ((this as { __items?: unknown[] }).__items ??= []);
  currentItems.push(...items);
};

collectionPrototype.removeAll = function removeAll() {
  (this as { __items?: unknown[] }).__items = [];
};

collectionPrototype.getItems = function getItems() {
  return (this as { __items?: unknown[] }).__items ?? [];
};

collectionPrototype.isInitialized = function isInitialized() {
  return true;
};

collectionPrototype.contains = function contains(item: unknown) {
  return ((this as { __items?: unknown[] }).__items ?? []).includes(item);
};

articlePrototype.toJSON = function toJSON(this: Article) {
  return {
    id: this.id,
    slug: this.slug,
    title: this.title,
    description: this.description,
    body: this.body,
    tagList: this.tagList,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    favoritesCount: this.favoritesCount,
    favorited: false,
    comments: [],
    author: {
      username: this.author.username,
      bio: this.author.bio,
      image: this.author.image,
      following: false,
    },
    coAuthors: this.coAuthors.getItems().map((coAuthor) => coAuthor.email),
  };
};

type CollectionStub<T> = {
  add: (...items: T[]) => void;
  removeAll: () => void;
  getItems: () => T[];
  isInitialized: () => boolean;
  contains: (item: T) => boolean;
};

function createCollectionStub<T>(initialItems: T[] = []): CollectionStub<T> {
  let items = [...initialItems];

  return {
    add: (...nextItems: T[]) => {
      items.push(...nextItems);
    },
    removeAll: () => {
      items = [];
    },
    getItems: () => items,
    isInitialized: () => true,
    contains: (item: T) => items.includes(item),
  };
}

function createUser(id: number, username: string, email: string) {
  const user = new User(username, email, 'password');
  user.id = id;
  (user.articles as unknown) = createCollectionStub<Article>();
  (user.coAuthoredArticles as unknown) = createCollectionStub<Article>();
  (user.favorites as unknown) = createCollectionStub<Article>();
  (user.followers as unknown) = createCollectionStub<User>();
  (user.followed as unknown) = createCollectionStub<User>();
  return user;
}

function createArticle(author: User, initialCoAuthors: User[] = []) {
  const article = new Article(author, 'Original title', 'Original description', 'Original body');
  (article.coAuthors as unknown) = createCollectionStub<User>(initialCoAuthors);
  return article;
}

function createService({
  persistAndFlush = async () => undefined,
  flush = async () => undefined,
  articleRepository,
  userRepository,
}: {
  persistAndFlush?: (entity: unknown) => Promise<unknown>;
  flush?: () => Promise<unknown>;
  articleRepository?: Partial<ArticleRepositoryMock>;
  userRepository?: Partial<UserRepositoryMock>;
}) {
  const em = {
    persistAndFlush,
    flush,
  } as unknown as EntityManager;

  const resolvedArticleRepository: ArticleRepositoryMock = {
    findOneOrFail: async () => {
      throw new Error('articleRepository.findOneOrFail was not mocked');
    },
    nativeDelete: async () => undefined,
    ...articleRepository,
  };

  const resolvedCommentRepository = {} as CommentRepositoryMock;

  const resolvedUserRepository: UserRepositoryMock = {
    findOne: async () => {
      throw new Error('userRepository.findOne was not mocked');
    },
    find: async () => [],
    ...userRepository,
  };

  return new ArticleService(
    em,
    resolvedArticleRepository as never,
    resolvedCommentRepository as never,
    resolvedUserRepository as never,
  );
}

test('create assigns co-authors from unique email addresses and excludes the original author', async () => {
  const author = createUser(1, 'author', 'author@example.com');
  const firstCoAuthor = createUser(2, 'coauthor-one', 'coauthor1@example.com');
  const secondCoAuthor = createUser(3, 'coauthor-two', 'coauthor2@example.com');

  let persistedArticle: Article | undefined;

  const service = createService({
    persistAndFlush: async (entity) => {
      persistedArticle = entity as Article;
    },
    userRepository: {
      findOne: async () => author,
      find: async () => [firstCoAuthor, secondCoAuthor],
    },
  });

  const dto: CreateArticleDto = {
    title: 'Shared draft',
    description: 'desc',
    body: 'body',
    tagList: ['nestjs'],
    coAuthors: ['coauthor1@example.com', 'author@example.com', 'coauthor2@example.com', 'coauthor1@example.com', '  '],
  };

  const result = await service.create(author.id, dto);

  assert.ok(persistedArticle instanceof Article);
  assert.deepEqual(
    persistedArticle.coAuthors.getItems().map((coAuthor) => coAuthor.email),
    ['coauthor1@example.com', 'coauthor2@example.com'],
  );
  assert.deepEqual(result.article.coAuthors, ['coauthor1@example.com', 'coauthor2@example.com']);
});

test('create rejects unknown co-author email addresses', async () => {
  const author = createUser(1, 'author', 'author@example.com');

  const service = createService({
    userRepository: {
      findOne: async () => author,
      find: async () => [],
    },
  });

  const dto: CreateArticleDto = {
    title: 'Shared draft',
    description: 'desc',
    body: 'body',
    tagList: [],
    coAuthors: ['missing@example.com'],
  };

  await assert.rejects(
    () => service.create(author.id, dto),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.deepEqual(error.getResponse(), {
        errors: { coAuthors: ['Unknown user email: missing@example.com'] },
      });
      return true;
    },
  );
});

test('update allows an assigned co-author to edit an article', async () => {
  const author = createUser(1, 'author', 'author@example.com');
  const coAuthor = createUser(2, 'editor', 'editor@example.com');
  const article = createArticle(author, [coAuthor]);
  article.id = 10;

  const service = createService({
    flush: async () => undefined,
    articleRepository: {
      findOneOrFail: async () => article,
    },
    userRepository: {
      findOne: async () => coAuthor,
      find: async () => [coAuthor],
    },
  });

  const result = await service.update(coAuthor.id, article.slug, {
    title: 'Updated title',
    description: 'Updated description',
    body: 'Updated body',
    tagList: ['updated'],
    coAuthors: [coAuthor.email],
  });

  assert.equal(article.title, 'Updated title');
  assert.equal(article.description, 'Updated description');
  assert.equal(article.body, 'Updated body');
  assert.deepEqual(article.tagList, ['updated']);
  assert.deepEqual(
    article.coAuthors.getItems().map((user) => user.email),
    [coAuthor.email],
  );
  assert.deepEqual(result.article.coAuthors, [coAuthor.email]);
});

test('update rejects users who are neither author nor co-author', async () => {
  const author = createUser(1, 'author', 'author@example.com');
  const coAuthor = createUser(2, 'editor', 'editor@example.com');
  const outsider = createUser(3, 'outsider', 'outsider@example.com');
  const article = createArticle(author, [coAuthor]);
  article.id = 10;

  const service = createService({
    articleRepository: {
      findOneOrFail: async () => article,
    },
    userRepository: {
      findOne: async () => outsider,
    },
  });

  await assert.rejects(
    () =>
      service.update(outsider.id, article.slug, {
        title: 'Updated title',
        description: 'Updated description',
        body: 'Updated body',
        tagList: [],
        coAuthors: [coAuthor.email],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.deepEqual(error.getResponse(), {
        errors: { article: ['You are not allowed to edit this article'] },
      });
      return true;
    },
  );
});

test('delete allows an assigned co-author to delete an article', async () => {
  const author = createUser(1, 'author', 'author@example.com');
  const coAuthor = createUser(2, 'editor', 'editor@example.com');
  const article = createArticle(author, [coAuthor]);
  article.id = 10;

  let deletedWhere: unknown;

  const service = createService({
    articleRepository: {
      findOneOrFail: async () => article,
      nativeDelete: async (where) => {
        deletedWhere = where;
        return 1;
      },
    },
  });

  const result = await service.delete(coAuthor.id, article.slug);

  assert.deepEqual(deletedWhere, { slug: article.slug });
  assert.equal(result, 1);
});

test.after(() => {
  collectionPrototype.validateItemType = originalValidateItemType;
  collectionPrototype.add = originalAdd;
  collectionPrototype.removeAll = originalRemoveAll;
  collectionPrototype.getItems = originalGetItems;
  collectionPrototype.isInitialized = originalIsInitialized;
  collectionPrototype.contains = originalContains;
  articlePrototype.toJSON = originalToJSON;
});
