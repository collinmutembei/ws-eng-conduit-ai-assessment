import assert from 'node:assert/strict';
import test from 'node:test';
import { EntityManager } from '@mikro-orm/core';
import { User } from './user.entity';
import { UserService } from './user.service';

type QueryBuilderResult = {
  count: string | number;
};

type QueryBuilderMock = {
  orderBy: (order: unknown) => QueryBuilderMock;
  clone: () => QueryBuilderMock;
  count: (field: string, distinct: boolean) => QueryBuilderMock;
  execute: (mode: string) => Promise<QueryBuilderResult>;
  limit: (value: number) => QueryBuilderMock;
  offset: (value: number) => QueryBuilderMock;
  getResult: () => Promise<User[]>;
};

type UserRepositoryMock = {
  createQueryBuilder: (alias: string) => QueryBuilderMock;
};

function createUser(id: number, username: string, email: string, image = '') {
  const user = new User(username, email, 'password');
  user.id = id;
  user.image = image;
  return user;
}

function createQueryBuilder(users: User[], usersCount: string | number) {
  const state = {
    limit: undefined as number | undefined,
    offset: undefined as number | undefined,
  };

  const queryBuilder: QueryBuilderMock = {
    orderBy: () => queryBuilder,
    clone: () => countBuilder,
    count: () => queryBuilder,
    execute: async () => ({ count: usersCount }),
    limit: (value: number) => {
      state.limit = value;
      return queryBuilder;
    },
    offset: (value: number) => {
      state.offset = value;
      return queryBuilder;
    },
    getResult: async () => users,
  };

  const countBuilder: QueryBuilderMock = {
    orderBy: () => countBuilder,
    clone: () => countBuilder,
    count: () => countBuilder,
    execute: async () => ({ count: usersCount }),
    limit: () => countBuilder,
    offset: () => countBuilder,
    getResult: async () => users,
  };

  return { queryBuilder, state };
}

function createService({ users, usersCount }: { users: User[]; usersCount: string | number }) {
  const { queryBuilder, state } = createQueryBuilder(users, usersCount);

  const userRepository: UserRepositoryMock = {
    createQueryBuilder: (alias: string) => {
      assert.equal(alias, 'u');
      return queryBuilder;
    },
  };

  const em = {} as EntityManager;
  const service = new UserService(userRepository as never, em);

  return { service, state };
}

test('findAllWithPagination returns only public user data', async () => {
  const { service } = createService({
    users: [
      createUser(1, 'zolly', 'zolly@example.com', 'https://img.example/zolly.png'),
      createUser(2, 'john', 'john@example.com'),
    ],
    usersCount: '2',
  });

  const result = await service.findAllWithPagination({});

  assert.deepEqual(result, {
    users: [
      { username: 'zolly', image: 'https://img.example/zolly.png' },
      { username: 'john', image: 'https://api.dicebear.com/9.x/initials/svg?seed=U' },
    ],
    usersCount: '2',
  });

  assert.ok(!('email' in result.users[0]));
  assert.ok(!('token' in result.users[0]));
  assert.ok(!('password' in result.users[0]));
});

test('findAllWithPagination applies limit and offset filters', async () => {
  const { service, state } = createService({
    users: [createUser(1, 'zolly', 'zolly@example.com')],
    usersCount: 1,
  });

  await service.findAllWithPagination({ limit: '10', offset: '20' });

  assert.equal(state.limit, 10);
  assert.equal(state.offset, 20);
});
