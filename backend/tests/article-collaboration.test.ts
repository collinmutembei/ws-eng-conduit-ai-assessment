import test from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

import { Article } from '../src/article/article.entity';
import { ArticleService } from '../src/article/article.service';
import { User } from '../src/user/user.entity';
import { UserService } from '../src/user/user.service';

function resolveCoAuthorsForTest(service: ArticleService) {
  return (service as unknown as Record<string, unknown>).resolveCoAuthors as (
    coAuthors: string[] | undefined,
    authorId: number,
  ) => Promise<User[]>;
}

function isLockExpiredForTest(service: ArticleService) {
  return (service as unknown as Record<string, unknown>).isLockExpired as (article: Article) => boolean;
}

function createUser(id: number, username: string, email: string) {
  const user = new User(username, email, 'password');
  user.id = id;
  return user;
}

function createArticle(author: User) {
  const article = new Article(author, 'Original title', 'Description', 'Body');
  const coAuthorItems: User[] = [];

  article.id = 100;
  Reflect.defineProperty(article, '__helper', {
    value: {
      assign: (data: Partial<Article>) => Object.assign(article, data),
    },
    configurable: true,
  });
  article.coAuthors = {
    getItems: () => coAuthorItems,
    set: (users: User[]) => {
      coAuthorItems.splice(0, coAuthorItems.length, ...users);
    },
  } as unknown as Article['coAuthors'];
  article.toJSON = ((() =>
    ({
      slug: article.slug,
      title: article.title,
      lockedBy: article.lockedBy?.id,
      coAuthors: article.coAuthors.getItems().map((user) => user.username),
    })) as unknown) as Article['toJSON'];

  return article;
}

function setCoAuthors(article: Article, users: User[]) {
  article.coAuthors.set(users);
}

function createArticleService(options?: {
  currentUsersById?: Map<number, User>;
  article?: Article;
  foundUsers?: User[];
}) {
  let flushCount = 0;
  let lastFindQuery: unknown;

  const em = {
    flush: async () => {
      flushCount += 1;
    },
    persistAndFlush: async () => {
      flushCount += 1;
    },
    removeAndFlush: async () => {
      flushCount += 1;
    },
  };

  const articleRepository = {
    findOneOrFail: async () => {
      if (!options?.article) {
        throw new Error('Missing article fixture');
      }

      return options.article;
    },
    nativeDelete: async () => 1,
  };

  const commentRepository = {
    getReference: (id: number) => ({ id }),
  };

  const userRepository = {
    findOneOrFail: async (query: number | { id: number }) => {
      const id = typeof query === 'number' ? query : query.id;
      const user = options?.currentUsersById?.get(id);

      if (!user) {
        throw new Error(`Missing user fixture for id ${id}`);
      }

      return user;
    },
    find: async (query: unknown) => {
      lastFindQuery = query;
      return options?.foundUsers ?? [];
    },
    findOne: async () => undefined,
  };

  const service = new ArticleService(
    em as unknown as ConstructorParameters<typeof ArticleService>[0],
    articleRepository as unknown as ConstructorParameters<typeof ArticleService>[1],
    commentRepository as unknown as ConstructorParameters<typeof ArticleService>[2],
    userRepository as unknown as ConstructorParameters<typeof ArticleService>[3],
  );

  return {
    service,
    getFlushCount: () => flushCount,
    getLastFindQuery: () => lastFindQuery,
  };
}

test('resolveCoAuthors batches identifier lookup, excludes the author, and deduplicates matches', async () => {
  const author = createUser(1, 'owner', 'owner@example.com');
  const firstCoAuthor = createUser(2, 'writer-one', 'writer-one@example.com');
  const secondCoAuthor = createUser(3, 'writer-two', 'writer-two@example.com');
  const { service, getLastFindQuery } = createArticleService({
    foundUsers: [author, firstCoAuthor, secondCoAuthor],
  });

  const coAuthors = await resolveCoAuthorsForTest(service)(
    [' writer-one ', 'writer-two@example.com', 'owner', 'writer-one'],
    author.id,
  );

  assert.deepEqual(
    coAuthors.map((user: User) => user.id),
    [2, 3],
  );
  assert.deepEqual(getLastFindQuery(), {
    $or: [
      { username: { $in: ['writer-one', 'writer-two@example.com', 'owner'] } },
      { email: { $in: ['writer-one', 'writer-two@example.com', 'owner'] } },
    ],
  });
});

test('resolveCoAuthors throws a validation error when an identifier cannot be resolved', async () => {
  const author = createUser(1, 'owner', 'owner@example.com');
  const knownUser = createUser(2, 'writer-one', 'writer-one@example.com');
  const { service } = createArticleService({
    foundUsers: [knownUser],
  });

  await assert.rejects(
    async () => resolveCoAuthorsForTest(service)(['writer-one', 'missing@example.com'], author.id),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.deepEqual((error as BadRequestException).getResponse(), {
        message: 'Input data validation failed',
        errors: { coAuthors: 'Users not found: missing@example.com' },
      });
      return true;
    },
  );
});

test('update allows a co-author with a valid lock to change article fields and co-authors', async () => {
  const author = createUser(1, 'owner', 'owner@example.com');
  const editor = createUser(2, 'editor', 'editor@example.com');
  const nextCoAuthor = createUser(3, 'reviewer', 'reviewer@example.com');
  const article = createArticle(author);
  setCoAuthors(article, [editor]);
  article.lockedBy = editor;
  article.lockedAt = new Date(Date.now() - 30_000);
  article.lastPingAt = new Date();

  const { service, getFlushCount } = createArticleService({
    currentUsersById: new Map([
      [author.id, author],
      [editor.id, editor],
      [nextCoAuthor.id, nextCoAuthor],
    ]),
    article,
    foundUsers: [author, nextCoAuthor],
  });

  await service.update(editor.id, article.slug, {
    title: 'Updated title',
    coAuthors: [author.email, nextCoAuthor.username],
  });

  assert.equal(article.title, 'Updated title');
  assert.deepEqual(
    article.coAuthors.getItems().map((user) => user.id),
    [nextCoAuthor.id],
  );
  assert.equal(getFlushCount(), 1);
});

test('update rejects a co-author when another user holds an active lock', async () => {
  const author = createUser(1, 'owner', 'owner@example.com');
  const editor = createUser(2, 'editor', 'editor@example.com');
  const otherEditor = createUser(3, 'other-editor', 'other-editor@example.com');
  const article = createArticle(author);
  setCoAuthors(article, [editor]);
  article.lockedBy = otherEditor;
  article.lockedAt = new Date(Date.now() - 30_000);
  article.lastPingAt = new Date();

  const { service } = createArticleService({
    currentUsersById: new Map([
      [author.id, author],
      [editor.id, editor],
      [otherEditor.id, otherEditor],
    ]),
    article,
  });

  await assert.rejects(() => service.update(editor.id, article.slug, { title: 'Blocked change' }), ConflictException);
});

test('lock rejects users who are not the author or a co-author', async () => {
  const author = createUser(1, 'owner', 'owner@example.com');
  const outsider = createUser(2, 'outsider', 'outsider@example.com');
  const article = createArticle(author);

  const { service } = createArticleService({
    currentUsersById: new Map([
      [author.id, author],
      [outsider.id, outsider],
    ]),
    article,
  });

  await assert.rejects(() => service.lock(outsider.id, article.slug), ForbiddenException);
});

test('lock allows taking over an expired lock', async () => {
  const author = createUser(1, 'owner', 'owner@example.com');
  const editor = createUser(2, 'editor', 'editor@example.com');
  const previousEditor = createUser(3, 'previous', 'previous@example.com');
  const article = createArticle(author);
  setCoAuthors(article, [editor]);
  article.lockedBy = previousEditor;
  article.lockedAt = new Date(Date.now() - 10 * 60 * 1000);
  article.lastPingAt = new Date(Date.now() - 10 * 60 * 1000);

  const { service, getFlushCount } = createArticleService({
    currentUsersById: new Map([
      [author.id, author],
      [editor.id, editor],
      [previousEditor.id, previousEditor],
    ]),
    article,
  });

  await service.lock(editor.id, article.slug);

  assert.equal(article.lockedBy?.id, editor.id);
  assert.ok(article.lockedAt instanceof Date);
  assert.ok(article.lastPingAt instanceof Date);
  assert.equal(getFlushCount(), 1);
});

test('pingLock refreshes the heartbeat for the current lock owner', async () => {
  const author = createUser(1, 'owner', 'owner@example.com');
  const editor = createUser(2, 'editor', 'editor@example.com');
  const article = createArticle(author);
  setCoAuthors(article, [editor]);
  article.lockedBy = editor;
  article.lockedAt = new Date(Date.now() - 60_000);
  article.lastPingAt = new Date(Date.now() - 60_000);

  const previousPing = article.lastPingAt.getTime();

  const { service, getFlushCount } = createArticleService({
    currentUsersById: new Map([
      [author.id, author],
      [editor.id, editor],
    ]),
    article,
  });

  await service.pingLock(editor.id, article.slug);

  assert.ok((article.lastPingAt?.getTime() ?? 0) >= previousPing);
  assert.equal(getFlushCount(), 1);
});

test('unlock clears lock state for a collaborating user', async () => {
  const author = createUser(1, 'owner', 'owner@example.com');
  const editor = createUser(2, 'editor', 'editor@example.com');
  const article = createArticle(author);
  setCoAuthors(article, [editor]);
  article.lockedBy = editor;
  article.lockedAt = new Date();
  article.lastPingAt = new Date();

  const { service, getFlushCount } = createArticleService({
    currentUsersById: new Map([
      [author.id, author],
      [editor.id, editor],
    ]),
    article,
  });

  await service.unlock(editor.id, article.slug);

  assert.equal(article.lockedBy, undefined);
  assert.equal(article.lockedAt, undefined);
  assert.equal(article.lastPingAt, undefined);
  assert.equal(getFlushCount(), 1);
});

test('delete allows a co-author to remove an article', async () => {
  const author = createUser(1, 'owner', 'owner@example.com');
  const editor = createUser(2, 'editor', 'editor@example.com');
  const article = createArticle(author);
  setCoAuthors(article, [editor]);

  const { service, getFlushCount } = createArticleService({
    currentUsersById: new Map([
      [author.id, author],
      [editor.id, editor],
    ]),
    article,
  });

  const result = await service.delete(editor.id, article.slug);

  assert.equal(result, 1);
  assert.equal(getFlushCount(), 1);
});

test('delete rejects a user who is neither the author nor a co-author', async () => {
  const author = createUser(1, 'owner', 'owner@example.com');
  const outsider = createUser(2, 'outsider', 'outsider@example.com');
  const article = createArticle(author);

  const { service } = createArticleService({
    currentUsersById: new Map([
      [author.id, author],
      [outsider.id, outsider],
    ]),
    article,
  });

  await assert.rejects(() => service.delete(outsider.id, article.slug), ForbiddenException);
});

test('isLockExpired falls back to lockedAt when no heartbeat exists yet', () => {
  const author = createUser(1, 'owner', 'owner@example.com');
  const editor = createUser(2, 'editor', 'editor@example.com');
  const article = createArticle(author);
  setCoAuthors(article, [editor]);
  article.lockedBy = editor;
  article.lockedAt = new Date(Date.now() - 60_000);
  article.lastPingAt = undefined;

  const { service } = createArticleService({
    currentUsersById: new Map([
      [author.id, author],
      [editor.id, editor],
    ]),
    article,
  });

  assert.equal(isLockExpiredForTest(service)(article), false);
});

test('findAllForDropdown requests users in username order and returns serialized results', async () => {
  const orderByCalls: unknown[] = [];
  const firstUser = { toJSON: () => ({ username: 'alice' }) };
  const secondUser = { toJSON: () => ({ username: 'bob' }) };

  const userRepository = {
    findAll: async (options?: unknown) => {
      orderByCalls.push(options);
      return [firstUser, secondUser];
    },
  };

  const service = new UserService(
    userRepository as unknown as ConstructorParameters<typeof UserService>[0],
    {} as ConstructorParameters<typeof UserService>[1],
  );

  const result = await service.findAllForDropdown();

  assert.deepEqual(orderByCalls, [{ orderBy: { username: 'ASC' } }]);
  assert.deepEqual(result, {
    users: [{ username: 'alice' }, { username: 'bob' }],
  });
});
