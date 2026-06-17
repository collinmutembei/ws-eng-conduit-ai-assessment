import { Migration } from '@mikro-orm/migrations';

export class AddArticleCoAuthorsMigration extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table `article_co_authors` (`article_id` int unsigned not null, `user_id` int unsigned not null) default character set utf8mb4 engine = InnoDB;',
    );
    this.addSql('alter table `article_co_authors` add index `article_co_authors_article_id_index`(`article_id`);');
    this.addSql('alter table `article_co_authors` add index `article_co_authors_user_id_index`(`user_id`);');
    this.addSql('alter table `article_co_authors` add primary key `article_co_authors_pkey`(`article_id`, `user_id`);');

    this.addSql(
      'alter table `article_co_authors` add constraint `article_co_authors_article_id_foreign` foreign key (`article_id`) references `article` (`id`) on update cascade on delete cascade;',
    );
    this.addSql(
      'alter table `article_co_authors` add constraint `article_co_authors_user_id_foreign` foreign key (`user_id`) references `user` (`id`) on update cascade on delete cascade;',
    );
  }
}
