import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

test('Article entity defines co-authors and locking fields', () => {
  const articleEntity = read('src', 'article', 'article.entity.ts');

  assert.match(articleEntity, /@ManyToMany\(\(\) => User, \(user\) => user\.coAuthoredArticles, \{ owner: true \}\)/);
  assert.match(articleEntity, /coAuthors = new Collection<User>\(this\);/);
  assert.match(articleEntity, /@ManyToOne\(\(\) => User, \{ fieldName: 'locked_by_id', nullable: true \}\)/);
  assert.match(articleEntity, /lockedBy\?: User;/);
  assert.match(articleEntity, /@Property\(\{ type: 'date', nullable: true, fieldName: 'locked_at' \}\)/);
  assert.match(articleEntity, /lockedAt\?: Date;/);
  assert.match(articleEntity, /@Property\(\{ type: 'date', nullable: true, fieldName: 'last_ping_at' \}\)/);
  assert.match(articleEntity, /lastPingAt\?: Date;/);
});

test('User entity defines inverse co-authored articles relation', () => {
  const userEntity = read('src', 'user', 'user.entity.ts');

  assert.match(userEntity, /@ManyToMany\(\(\) => Article, \(article\) => article\.coAuthors, \{ hidden: true \}\)/);
  assert.match(userEntity, /coAuthoredArticles = new Collection<Article>\(this\);/);
});

test('Article DTOs expose coAuthors as usernames or emails', () => {
  const createDto = read('src', 'article', 'dto', 'create-article.dto.ts');
  const updateDto = read('src', 'article', 'dto', 'update-article.dto.ts');

  assert.match(createDto, /readonly coAuthors\?: string\[];/);
  assert.match(updateDto, /readonly coAuthors\?: string\[];/);
});

test('Article interfaces expose create and update request wrappers', () => {
  const articleInterface = read('src', 'article', 'article.interface.ts');

  assert.ok(articleInterface.includes('export interface ICreateArticle {'));
  assert.ok(articleInterface.includes('article: CreateArticleDto;'));
  assert.ok(articleInterface.includes('export interface IUpdateArticle {'));
  assert.ok(articleInterface.includes('article: UpdateArticleDto;'));
});

test('Article service guards entity assignment from raw co-author identifiers', () => {
  const articleService = read('src', 'article', 'article.service.ts');

  assert.match(articleService, /CreateArticleDto, CreateCommentDto, UpdateArticleDto/);
  assert.match(articleService, /const \{ coAuthors: _coAuthors, \.\.\.updateData \} = articleData;/);
  assert.match(articleService, /wrap\(article\)\.assign\(updateData as any\);/);
});
