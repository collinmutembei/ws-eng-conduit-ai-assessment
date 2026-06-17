import React, { useEffect } from 'react';
import { getAllUsers } from '../../services/conduit';
import { store } from '../../state/store';
import { useStore } from '../../state/storeHooks';
import { buildGenericFormField } from '../../types/genericFormField';
import { ContainerPage } from '../ContainerPage/ContainerPage';
import { GenericForm } from '../GenericForm/GenericForm';
import {
  addTag,
  clearErrors,
  EditorState,
  loadAvailableCoAuthors,
  removeTag,
  setCoAuthors,
  updateField,
} from './ArticleEditor.slice';

export function ArticleEditor({
  onSubmit,
  onCancel,
}: {
  onSubmit: (ev: React.FormEvent) => void;
  onCancel?: () => void;
}) {
  const { article, submitting, tag, errors, availableCoAuthors, lockAcquired, isLockedByOther, lockError } = useStore(
    ({ editor }) => editor,
  );
  const currentUser = useStore(({ app }) => app.user);

  useEffect(() => {
    void loadAvailableUsers();
  }, []);

  const selectableCoAuthors = availableCoAuthors.filter(({ username }) => username !== currentUser?.username);
  const disabled = submitting || isLockedByOther;

  return (
    <div className='editor-page'>
      <ContainerPage>
        <div className='col-md-10 offset-md-1 col-xs-12'>
          {lockError && (
            <div className={`alert ${isLockedByOther ? 'alert-danger' : 'alert-warning'}`}>{lockError}</div>
          )}
          {lockAcquired && <div className='alert alert-info'>This article is locked for editing by you.</div>}

          <fieldset className='form-group'>
            <label className='form-control-label' htmlFor='co-authors-select'>
              Co-Authors
            </label>
            <select
              id='co-authors-select'
              className='form-control'
              multiple
              size={Math.min(Math.max(selectableCoAuthors.length, 4), 8)}
              disabled={disabled}
              value={article.coAuthors ?? []}
              onChange={onCoAuthorsChange}
            >
              {selectableCoAuthors.map(({ username }) => (
                <option key={username} value={username}>
                  {username}
                </option>
              ))}
            </select>
            <small className='text-muted'>Hold Ctrl/Cmd to select multiple co-authors.</small>
            <div className='tag-list' style={{ marginTop: '0.75rem' }}>
              {article.coAuthors?.map((username) => (
                <span key={username} className='tag-default tag-pill'>
                  {username}
                </span>
              ))}
            </div>
          </fieldset>

          <GenericForm
            formObject={{ ...article, tag } as unknown as Record<string, string | null>}
            disabled={disabled}
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
          />

          {onCancel && (
            <button
              className='btn btn-outline-secondary pull-xs-right'
              type='button'
              disabled={disabled}
              style={{ marginTop: '1rem', marginRight: '0.5rem' }}
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
        </div>
      </ContainerPage>
    </div>
  );
}

async function loadAvailableUsers() {
  try {
    store.dispatch(loadAvailableCoAuthors(await getAllUsers()));
  } catch {
    store.dispatch(clearErrors());
  }
}

function onUpdateField(name: string, value: string) {
  store.dispatch(updateField({ name: name as keyof EditorState['article'], value }));
}

function onCoAuthorsChange(ev: React.ChangeEvent<HTMLSelectElement>) {
  store.dispatch(setCoAuthors(Array.from(ev.target.selectedOptions, ({ value }) => value)));
}

function onAddTag() {
  store.dispatch(addTag());
}

function onRemoveTag(_: string, index: number) {
  store.dispatch(removeTag(index));
}
