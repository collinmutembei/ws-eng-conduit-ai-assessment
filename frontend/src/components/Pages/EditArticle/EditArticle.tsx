import React, { Fragment, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getArticle, lockArticle, pingArticleLock, releaseArticleLock, updateArticle } from '../../../services/conduit';
import { store } from '../../../state/store';
import { useStore } from '../../../state/storeHooks';
import { canEditArticle } from '../../../types/article';
import { GenericErrors } from '../../../types/error';
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
const LOCKED_BY_OTHER_MESSAGE = 'This article is currently locked for editing by another user.';

export function EditArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { loading } = useStore(({ editor }) => editor);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const releasedRef = useRef(false);

  useEffect(() => {
    if (!slug) {
      return;
    }

    releasedRef.current = false;

    void startEditingSession(slug).then((lockWasAcquired) => {
      if (!lockWasAcquired) {
        return;
      }

      heartbeatRef.current = setInterval(async () => {
        const result = await pingArticleLock(slug);

        result.match({
          err: (errors) => {
            store.dispatch(lockFailed(toLockFailure(errors)));
            clearHeartbeat(heartbeatRef);
          },
          ok: ({ lockedBy }) => {
            store.dispatch(lockAcquired({ lockedBy: lockedBy?.username ?? null }));
          },
        });
      }, LOCK_PING_INTERVAL_MS);
    });

    return () => {
      void cleanupEditingSession(slug, heartbeatRef, releasedRef);
    };
  }, [slug]);

  const handleSubmit = async (ev: React.FormEvent) => {
    if (!slug) {
      return;
    }

    ev.preventDefault();
    store.dispatch(startSubmitting());

    const result = await updateArticle(slug, store.getState().editor.article);

    result.match({
      err: async (errors) => {
        if (isLockRelatedError(errors)) {
          store.dispatch(lockFailed(toLockFailure(errors)));
          return;
        }

        store.dispatch(updateErrors(errors));
      },
      ok: async ({ slug: updatedSlug }) => {
        await cleanupEditingSession(slug, heartbeatRef, releasedRef);
        location.hash = `#/article/${updatedSlug}`;
      },
    });
  };

  const handleCancel = () => {
    if (!slug) {
      location.hash = '#/';
      return;
    }

    void cleanupEditingSession(slug, heartbeatRef, releasedRef).then(() => {
      location.hash = `#/article/${slug}`;
    });
  };

  return <Fragment>{!loading && slug && <ArticleEditor onSubmit={handleSubmit} onCancel={handleCancel} />}</Fragment>;
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
        store.dispatch(lockFailed(toLockFailure(errors)));
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

async function cleanupEditingSession(
  slug: string,
  heartbeatRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
  releasedRef: React.MutableRefObject<boolean>,
) {
  clearHeartbeat(heartbeatRef);

  if (releasedRef.current || !store.getState().editor.lockAcquired) {
    return;
  }

  releasedRef.current = true;
  await releaseLock(slug);
}

function clearHeartbeat(heartbeatRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>) {
  if (heartbeatRef.current) {
    clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
  }
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

function toLockFailure(errors: GenericErrors): { message: string; isLockedByOther?: boolean } {
  const message = firstError(errors);

  if (isLockedByOtherMessage(message)) {
    return { message: LOCKED_BY_OTHER_MESSAGE, isLockedByOther: true };
  }

  return { message };
}

function isLockRelatedError(errors: GenericErrors): boolean {
  const message = firstError(errors);

  return [
    'Article is currently locked by another user.',
    'Article lock is held by another user.',
    'Your article lock has expired.',
    'You do not hold a valid lock for this article.',
  ].includes(message);
}

function isLockedByOtherMessage(message: string): boolean {
  return ['Article is currently locked by another user.', 'Article lock is held by another user.'].includes(message);
}

function firstError(errors: GenericErrors): string {
  return Object.values(errors)[0]?.[0] || 'Unable to continue editing this article.';
}
