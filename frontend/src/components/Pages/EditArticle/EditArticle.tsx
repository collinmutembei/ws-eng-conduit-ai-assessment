import React, { Fragment, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  acquireArticleLock,
  getArticle,
  pingArticleLock,
  releaseArticleLock,
  updateArticle,
} from '../../../services/conduit';
import { store } from '../../../state/store';
import { useStore } from '../../../state/storeHooks';
import { GenericErrors } from '../../../types/error';
import { ArticleEditor } from '../../ArticleEditor/ArticleEditor';
import {
  initializeEditor,
  loadArticle,
  lockAcquired,
  lockLost,
  registerPingFailure,
  resetPingFailures,
  startLockAcquisition,
  startSubmitting,
  stopSubmitting,
  updateErrors,
} from '../../ArticleEditor/ArticleEditor.slice';

const LOCK_PING_INTERVAL_MS = 60_000;
const MAX_CONSECUTIVE_PING_FAILURES = 2;
const DEFAULT_LOCK_CONFLICT_MESSAGE = 'This article is currently locked for editing by another user.';

export function EditArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { loading } = useStore(({ editor }) => editor);

  useEffect(() => {
    if (!slug) {
      return;
    }

    let isMounted = true;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let consecutivePingFailures = 0;

    const stopPing = () => {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    };

    const handleLockFailure = (errors: GenericErrors) => {
      const message = errors.article?.[0] ?? DEFAULT_LOCK_CONFLICT_MESSAGE;
      stopPing();
      consecutivePingFailures = 0;
      store.dispatch(lockLost(message));
    };

    const startPing = () => {
      stopPing();

      pingInterval = setInterval(() => {
        void (async () => {
          const result = await pingArticleLock(slug);

          result.match({
            ok: () => {
              consecutivePingFailures = 0;
              store.dispatch(resetPingFailures());
            },
            err: (errors) => {
              consecutivePingFailures += 1;
              store.dispatch(registerPingFailure());

              if (consecutivePingFailures > MAX_CONSECUTIVE_PING_FAILURES) {
                handleLockFailure(errors);
              }
            },
          });
        })();
      }, LOCK_PING_INTERVAL_MS);
    };

    void (async () => {
      store.dispatch(initializeEditor());

      try {
        const { title, description, body, tagList, coAuthors, author } = await getArticle(slug);
        const currentUser = store.getState().app.user;

        if (author.username !== currentUser?.username && !coAuthors.includes(currentUser?.username ?? '')) {
          location.hash = '#/';
          return;
        }

        if (!isMounted) {
          return;
        }

        store.dispatch(loadArticle({ title, description, body, tagList, coAuthors }));
        store.dispatch(startLockAcquisition());

        const lockResult = await acquireArticleLock(slug);

        if (!isMounted) {
          return;
        }

        lockResult.match({
          ok: () => {
            consecutivePingFailures = 0;
            store.dispatch(lockAcquired());
            startPing();
          },
          err: handleLockFailure,
        });
      } catch {
        if (isMounted) {
          location.hash = '#/';
        }
      }
    })();

    return () => {
      isMounted = false;
      stopPing();
      void releaseArticleLock(slug);
    };
  }, [slug]);

  return <Fragment>{!loading && slug && <ArticleEditor onSubmit={onSubmit(slug)} />}</Fragment>;
}

function onSubmit(slug: string): (ev: React.FormEvent) => void {
  return async (ev) => {
    ev.preventDefault();

    store.dispatch(startSubmitting());
    const result = await updateArticle(slug, store.getState().editor.article);

    result.match({
      err: async (errors) => {
        const lockMessage = errors.article?.[0];

        if (lockMessage) {
          store.dispatch(lockLost(lockMessage));
          return;
        }

        store.dispatch(updateErrors(errors));
        store.dispatch(stopSubmitting());
      },
      ok: async ({ slug: updatedSlug }) => {
        await releaseArticleLock(slug);
        location.hash = `#/article/${updatedSlug}`;
      },
    });
  };
}
