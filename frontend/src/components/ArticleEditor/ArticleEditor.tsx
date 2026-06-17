import React, { useEffect } from 'react';
import { getAllUsers } from '../../services/conduit';
import { store } from '../../state/store';
import { useStore } from '../../state/storeHooks';
import { buildGenericFormField } from '../../types/genericFormField';
import { ContainerPage } from '../ContainerPage/ContainerPage';
import { GenericForm } from '../GenericForm/GenericForm';
import {
  addCoAuthor,
  addTag,
  clearErrors,
  EditorState,
  loadAvailableCoAuthors,
  removeCoAuthor,
  removeTag,
  updateField,
} from './ArticleEditor.slice';

export function ArticleEditor({ onSubmit }: { onSubmit: (ev: React.FormEvent) => void }) {
  const {
    article,
    submitting,
    tag,
    coAuthor,
    errors,
    availableCoAuthors,
    lockAcquired,
    lockError,
  } = useStore(({ editor }) => editor);
  const currentUser = useStore(({ app }) => app.user);

  useEffect(() => {
    void loadAvailableUsers();
  }, []);

  const coAuthorSuggestions = availableCoAuthors.filter(
    ({ username }) => username !== currentUser?.username && !article.coAuthors?.includes(username),
  );
  const disabled = submitting || (!!lockError && !lockAcquired);

  return (
    <div className='editor-page'>
      <ContainerPage>
        <div className='col-md-10 offset-md-1 col-xs-12'>
          {lockError && <div className='alert alert-danger'>{lockError}</div>}
          {lockAcquired && <div className='alert alert-info'>This article is locked for editing by you.</div>}

          <fieldset className='form-group'>
            <div className='input-group'>
              <input
                className='form-control'
                type='text'
                placeholder='Search users to add as co-authors'
                disabled={disabled}
                value={coAuthor}
                list='available-coauthors'
                onChange={onCoAuthorChange}
              />
              <button className='btn btn-outline-primary' type='button' disabled={disabled} onClick={onAddCoAuthor}>
                Add co-author
              </button>
            </div>
            <datalist id='available-coauthors'>
              {coAuthorSuggestions.map(({ username }) => (
                <option key={username} value={username} />
              ))}
            </datalist>
            <div className='tag-list' style={{ marginTop: '0.5rem' }}>
              {article.coAuthors?.map((username, index) => (
                <span key={username} className='tag-default tag-pill' onClick={() => onRemoveCoAuthor(username, index)}>
                  <i className='ion-close-round'></i>
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

function onCoAuthorChange(ev: React.ChangeEvent<HTMLInputElement>) {
  store.dispatch(updateField({ name: 'coAuthor', value: ev.target.value }));
}

function onAddTag() {
  store.dispatch(addTag());
}

function onRemoveTag(_: string, index: number) {
  store.dispatch(removeTag(index));
}

function onAddCoAuthor() {
  store.dispatch(addCoAuthor());
}

function onRemoveCoAuthor(_: string, index: number) {
  store.dispatch(removeCoAuthor(index));
}
