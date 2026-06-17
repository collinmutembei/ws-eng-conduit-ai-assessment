import React, { Fragment, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getArticle, pingArticleLock, releaseArticleLock, updateArticle, lockArticle } from '../../../services/conduit';
import { store } from '../../../state/store';
import { useStore } from '../../../state/storeHooks';
import { canEditArticle } from '../../../types/article';
import { ArticleEditor } from '../../ArticleEditor/ArticleEditor';
import {
  initializeEditor,
  loadArticle,
  lockAcquired,
  lockFailed,
  lockReleased,
  startLoadingEditor,
  startReleasingLock,
  startSubmitting,
  updateErrors,
} from '../../ArticleEditor/ArticleEditor.slice';

const LOCK_PING_INTERVAL_MS = 60000;

export function EditArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { loading } = useStore(({ editor }) => editor);

  useEffect(() => {
    if (!slug) {
      return;
    }

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let released = false;

    void startEditingSession(slug).then((lockWasAcquired) => {
      if (!lockWasAcquired) {
        return;
      }

      heartbeat = setInterval(async () => {
        const result = await pingArticleLock(slug);

        result.match({
          err: (errors) => {
            store.dispatch(lockFailed(firstError(errors)));
            if (heartbeat) {
              clearInterval(heartbeat);
              heartbeat = null;
            }
          },
          ok: ({ lockedBy }) => {
            store.dispatch(lockAcquired({ lockedBy: lockedBy?.username ?? null }));
          },
        });
      }, LOCK_PING_INTERVAL_MS);
    });

    return () => {
      if (heartbeat) {
        clearInterval(heartbeat);
      }

      if (!released && store.getState().editor.lockAcquired) {
        released = true;
        void releaseLock(slug);
      }
    };
  }, [slug]);

  return <Fragment>{!loading && <ArticleEditor onSubmit={onSubmit(slug!)} />}</Fragment>;
}

async function startEditingSession(slug: string): Promise<boolean> {
  store.dispatch(initializeEditor());
  store.dispatch(startLoadingEditor());

  try {
    const article = await getArticle(slug);

    if (!canEditArticle(article, store.getState().app.user)) {
      location.hash = '#/';
      return false;
    }

    const editorArticle = {
      title: article.title,
      description: article.description,
      body: article.body,
      tagList: article.tagList,
      coAuthors: article.coAuthors.map(({ username }) => username),
    };

    const result = await lockArticle(slug);

    return result.match({
      err: (errors) => {
        store.dispatch(loadArticle(editorArticle));
        store.dispatch(lockFailed(firstError(errors)));
        return false;
      },
      ok: ({ lockedBy }) => {
        store.dispatch(loadArticle(editorArticle));
        store.dispatch(lockAcquired({ lockedBy: lockedBy?.username ?? null }));
        return true;
      },
    });
  } catch {
    location.hash = '#/';
    return false;
  }
}

function onSubmit(slug: string): (ev: React.FormEvent) => void {
  return async (ev) => {
    ev.preventDefault();

    store.dispatch(startSubmitting());
    const result = await updateArticle(slug, store.getState().editor.article);

    result.match({
      err: (errors) => {
        store.dispatch(updateErrors(errors));
      },
      ok: ({ slug: updatedSlug }) => {
        void releaseLock(slug).then(() => {
          location.hash = `#/article/${updatedSlug}`;
        });
      },
    });
  };
}

async function releaseLock(slug: string) {
  store.dispatch(startReleasingLock());

  const result = await releaseArticleLock(slug);

  result.match({
    err: () => {
      store.dispatch(lockReleased());
    },
    ok: () => {
      store.dispatch(lockReleased());
    },
  });
}

function firstError(errors: Record<string, string[]>): string {
  return Object.values(errors)[0]?.[0] || 'Unable to continue editing this article.';
}
