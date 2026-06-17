import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import * as R from 'ramda';
import { ArticleForEditor } from '../../types/article';
import { GenericErrors } from '../../types/error';
import { Profile } from '../../types/profile';

export interface EditorState {
  article: ArticleForEditor;
  tag: string;
  availableCoAuthors: Profile[];
  submitting: boolean;
  errors: GenericErrors;
  loading: boolean;
  lockAcquired: boolean;
  isLockedByOther: boolean;
  lockError: string | null;
  lockOwner: string | null;
  releasingLock: boolean;
}

const initialState: EditorState = {
  article: { title: '', body: '', tagList: [], description: '', coAuthors: [] },
  tag: '',
  availableCoAuthors: [],
  submitting: false,
  errors: {},
  loading: true,
  lockAcquired: false,
  isLockedByOther: false,
  lockError: null,
  lockOwner: null,
  releasingLock: false,
};

const slice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    initializeEditor: () => initialState,
    updateField: (
      state,
      { payload: { name, value } }: PayloadAction<{ name: keyof EditorState['article'] | 'tag'; value: string }>,
    ) => {
      if (name === 'tag') {
        state.tag = value;
        return;
      }

      if (name !== 'tagList' && name !== 'coAuthors') {
        state.article[name] = value;
      }
    },
    updateErrors: (state, { payload: errors }: PayloadAction<GenericErrors>) => {
      state.errors = errors;
      state.submitting = false;
    },
    clearErrors: (state) => {
      state.errors = {};
    },
    startSubmitting: (state) => {
      state.submitting = true;
    },
    addTag: (state) => {
      if (state.tag.length > 0) {
        state.article.tagList.push(state.tag);
        state.tag = '';
      }
    },
    removeTag: (state, { payload: index }: PayloadAction<number>) => {
      state.article.tagList = R.remove(index, 1, state.article.tagList);
    },
    setCoAuthors: (state, { payload }: PayloadAction<string[]>) => {
      state.article.coAuthors = payload;
    },
    loadArticle: (state, { payload: article }: PayloadAction<ArticleForEditor>) => {
      state.article = { ...article, coAuthors: article.coAuthors ?? [] };
      state.loading = false;
      state.errors = {};
    },
    loadAvailableCoAuthors: (state, { payload: users }: PayloadAction<Profile[]>) => {
      state.availableCoAuthors = users;
    },
    startLoadingEditor: (state) => {
      state.loading = true;
    },
    finishLoadingEditor: (state) => {
      state.loading = false;
    },
    lockAcquired: (state, { payload }: PayloadAction<{ lockedBy: string | null }>) => {
      state.lockAcquired = true;
      state.isLockedByOther = false;
      state.lockError = null;
      state.lockOwner = payload.lockedBy;
    },
    lockReleased: (state) => {
      state.lockAcquired = false;
      state.isLockedByOther = false;
      state.lockError = null;
      state.lockOwner = null;
      state.releasingLock = false;
    },
    lockFailed: (state, { payload }: PayloadAction<{ message: string; isLockedByOther?: boolean }>) => {
      state.lockAcquired = false;
      state.isLockedByOther = payload.isLockedByOther ?? false;
      state.lockError = payload.message;
      state.errors = {};
      state.submitting = false;
    },
    startReleasingLock: (state) => {
      state.releasingLock = true;
    },
    finishReleasingLock: (state) => {
      state.releasingLock = false;
    },
  },
});

export const {
  initializeEditor,
  updateField,
  startSubmitting,
  updateErrors,
  clearErrors,
  addTag,
  removeTag,
  setCoAuthors,
  loadArticle,
  loadAvailableCoAuthors,
  startLoadingEditor,
  finishLoadingEditor,
  lockAcquired,
  lockReleased,
  lockFailed,
  startReleasingLock,
  finishReleasingLock,
} = slice.actions;

export default slice.reducer;
