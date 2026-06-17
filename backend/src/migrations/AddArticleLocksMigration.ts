import { Migration } from '@mikro-orm/migrations';

export class AddArticleLocksMigration extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table `article` add `locked_by_id` int unsigned null, add `locked_at` datetime null, add `last_ping_at` datetime null;',
    );
    this.addSql('alter table `article` add index `article_locked_by_id_index`(`locked_by_id`);');
    this.addSql(
      'alter table `article` add constraint `article_locked_by_id_foreign` foreign key (`locked_by_id`) references `user` (`id`) on update cascade on delete set null;',
    );
  }
}
