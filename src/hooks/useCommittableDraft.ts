import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';

interface CommittableDraftOptions<TValue> {
  value: TValue;
  toDraft: (value: TValue) => string;
  fromDraft: (text: string) => TValue;
  commit: (next: TValue) => void;
  commitUnchangedOnBlur?: boolean;
}

interface CommittableDraft {
  draft: string;
  setDraft: (next: string) => void;
  inputProps: {
    value: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onFocus: () => void;
    onBlur: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  };
}

export function useCommittableDraft<TValue>({
  value,
  toDraft,
  fromDraft,
  commit,
  commitUnchangedOnBlur = false,
}: CommittableDraftOptions<TValue>): CommittableDraft {
  const [draft, setDraft] = useState(() => toDraft(value));
  const [focused, setFocused] = useState(false);
  const [lastSeen, setLastSeen] = useState<TValue>(value);

  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  const commitRef = useRef(commit);
  const fromDraftRef = useRef(fromDraft);
  draftRef.current = draft;
  valueRef.current = value;
  commitRef.current = commit;
  fromDraftRef.current = fromDraft;

  useEffect(() => {
    if (focused || value === lastSeen) {
      return;
    }
    setLastSeen(value);
    setDraft(toDraft(value));
  }, [focused, lastSeen, toDraft, value]);

  useEffect(
    () => () => {
      const parsed = fromDraftRef.current(draftRef.current);
      if (parsed !== valueRef.current) commitRef.current(parsed);
    },
    []
  );

  const flush = () => {
    const parsed = fromDraft(draft);
    const normalized = toDraft(parsed);
    if (normalized !== draft) setDraft(normalized);
    if (parsed !== value || commitUnchangedOnBlur) commit(parsed);
  };

  return {
    draft,
    setDraft,
    inputProps: {
      value: draft,
      onChange: event => {
        setDraft(event.currentTarget.value);
      },
      onFocus: () => {
        setFocused(true);
      },
      onBlur: () => {
        setFocused(false);
        flush();
      },
      onKeyDown: event => {
        if (event.key === 'Enter') event.currentTarget.blur();
      },
    },
  };
}
