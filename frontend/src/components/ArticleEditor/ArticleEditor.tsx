import React, { useEffect, useMemo, useState } from 'react';
import { getPublicUsers } from '../../services/conduit';
import { store } from '../../state/store';
import { useStore } from '../../state/storeHooks';
import { buildGenericFormField } from '../../types/genericFormField';
import { PublicUserOption } from '../../types/user';
import { ContainerPage } from '../ContainerPage/ContainerPage';
import { GenericForm } from '../GenericForm/GenericForm';
import { addTag, EditorState, removeTag, setCoAuthors, updateField } from './ArticleEditor.slice';

export function ArticleEditor({ onSubmit }: { onSubmit: (ev: React.FormEvent) => void }) {
  const { article, submitting, tag, errors, lockAcquiring, lockConflict, lockMessage } = useStore(
    ({ editor }) => editor,
  );
  const currentUser = useStore(({ app }) => app.user);
  const [availableUsers, setAvailableUsers] = useState<PublicUserOption[]>([]);
  const formDisabled = submitting || lockAcquiring || lockConflict;

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      const { users } = await getPublicUsers();

      if (isMounted) {
        setAvailableUsers(users);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const selectableCoAuthors = useMemo(
    () =>
      availableUsers.filter(
        (user) => user.username !== currentUser?.username || article.coAuthors.includes(user.username),
      ),
    [article.coAuthors, availableUsers, currentUser?.username],
  );

  return (
    <div className='editor-page'>
      <ContainerPage>
        <div className='col-md-10 offset-md-1 col-xs-12'>
          {lockConflict && lockMessage ? (
            <div className='alert alert-warning' role='alert'>
              {lockMessage}
            </div>
          ) : null}
          <GenericForm
            formObject={{ ...article, tag } as unknown as Record<string, string | null>}
            disabled={formDisabled}
            errors={errors}
            onChange={onUpdateField}
            onSubmit={onSubmit}
            submitButtonText='Publish Article'
            onAddItemToList={onAddTag}
            onRemoveListItem={onRemoveTag}
            fields={[
              buildGenericFormField({ name: 'title', placeholder: 'Article Title' }),
              buildGenericFormField({ name: 'description', placeholder: "What's this article about?", lg: false }),
              buildGenericFormField({
                name: 'body',
                placeholder: 'Write your article (in markdown)',
                fieldType: 'textarea',
                rows: 8,
                lg: false,
              }),
              buildGenericFormField({
                name: 'tag',
                placeholder: 'Enter the tag name and press enter',
                listName: 'tagList',
                fieldType: 'list',
                lg: false,
              }),
            ]}
          >
            <fieldset className='form-group'>
              <label htmlFor='coAuthors' className='mb-1'>
                Co-authors
              </label>
              <select
                id='coAuthors'
                className='form-control'
                multiple
                disabled={formDisabled}
                value={article.coAuthors}
                onChange={onUpdateCoAuthors}
                size={Math.max(4, Math.min(8, selectableCoAuthors.length || 4))}
              >
                {selectableCoAuthors.map((user) => (
                  <option key={user.username} value={user.username}>
                    {user.username}
                  </option>
                ))}
              </select>
              <small className='text-muted'>Hold Ctrl/Cmd to select multiple co-authors.</small>
            </fieldset>
          </GenericForm>
        </div>
      </ContainerPage>
    </div>
  );
}

function onUpdateField(name: string, value: string) {
  store.dispatch(updateField({ name: name as keyof EditorState['article'], value }));
}

function onUpdateCoAuthors(ev: React.ChangeEvent<HTMLSelectElement>) {
  store.dispatch(setCoAuthors(Array.from(ev.target.selectedOptions, (option) => option.value)));
}

function onAddTag() {
  store.dispatch(addTag());
}

function onRemoveTag(_: string, index: number) {
  store.dispatch(removeTag(index));
}
