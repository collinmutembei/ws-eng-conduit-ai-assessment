import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ArticleForEditor } from '../../types/article';
import * as R from 'ramda';
import { GenericErrors } from '../../types/error';

export interface EditorState {
  article: ArticleForEditor;
  tag: string;
  submitting: boolean;
  errors: GenericErrors;
  loading: boolean;
  lockAcquiring: boolean;
  lockConflict: boolean;
  pingFailures: number;
  lockMessage: string | null;
}

const initialState: EditorState = {
  article: { title: '', body: '', tagList: [], coAuthors: [], description: '' },
  tag: '',
  submitting: false,
  errors: {},
  loading: true,
  lockAcquiring: false,
  lockConflict: false,
  pingFailures: 0,
  lockMessage: null,
};

const slice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    initializeEditor: () => initialState,
    startLockAcquisition: (state) => {
      state.lockAcquiring = true;
      state.lockConflict = false;
      state.lockMessage = null;
      state.pingFailures = 0;
    },
    lockAcquired: (state) => {
      state.lockAcquiring = false;
      state.lockConflict = false;
      state.lockMessage = null;
      state.pingFailures = 0;
    },
    lockLost: (state, { payload: message }: PayloadAction<string>) => {
      state.lockAcquiring = false;
      state.lockConflict = true;
      state.lockMessage = message;
      state.submitting = false;
    },
    registerPingFailure: (state) => {
      state.pingFailures += 1;
    },
    resetPingFailures: (state) => {
      state.pingFailures = 0;
    },
    stopSubmitting: (state) => {
      state.submitting = false;
    },
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
    setCoAuthors: (state, { payload: coAuthors }: PayloadAction<string[]>) => {
      state.article.coAuthors = coAuthors;
    },
    updateErrors: (state, { payload: errors }: PayloadAction<GenericErrors>) => {
      state.errors = errors;
      state.submitting = false;
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
    loadArticle: (state, { payload: article }: PayloadAction<ArticleForEditor>) => {
      state.article = article;
      state.loading = false;
      state.errors = {};
      state.submitting = false;
      state.lockConflict = false;
      state.lockMessage = null;
      state.pingFailures = 0;
    },
  },
});

export const {
  initializeEditor,
  startLockAcquisition,
  lockAcquired,
  lockLost,
  registerPingFailure,
  resetPingFailures,
  stopSubmitting,
  updateField,
  setCoAuthors,
  startSubmitting,
  addTag,
  removeTag,
  updateErrors,
  loadArticle,
} = slice.actions;

export default slice.reducer;
