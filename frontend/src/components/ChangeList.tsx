import type { ChangeEntry } from '../types';
import { Icon } from './Icon';

export function ChangeList({ changes, onChange, disabled = false }: {
  changes: ChangeEntry[];
  onChange: (changes: ChangeEntry[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, key: keyof ChangeEntry, value: string) => {
    onChange(changes.map((change, changeIndex) => changeIndex === index ? { ...change, [key]: value } : change));
  };

  return (
    <div className="changes-editor">
      <div className="field-group-heading">
        <div>
          <span className="field-label">Proposed changes</span>
          <span className="field-help">Add each field-level edit separately.</span>
        </div>
        {!disabled && (
          <button className="button button-quiet button-small" onClick={() => onChange([...changes, { field: '', before: '', after: '' }])} type="button">
            <Icon name="plus" size={16} />Add change
          </button>
        )}
      </div>
      {changes.length === 0 && <p className="inline-empty">No field changes added.</p>}
      {changes.map((change, index) => (
        <fieldset className="change-row" key={index}>
          <legend className="sr-only">Change {index + 1}</legend>
          <label className="form-field">
            <span>Field</span>
            <input disabled={disabled} onChange={(event) => update(index, 'field', event.target.value)} placeholder="Status" value={change.field} />
          </label>
          <label className="form-field">
            <span>Before</span>
            <input disabled={disabled} onChange={(event) => update(index, 'before', event.target.value)} placeholder="Current value" value={change.before} />
          </label>
          <label className="form-field">
            <span>After</span>
            <input disabled={disabled} onChange={(event) => update(index, 'after', event.target.value)} placeholder="Proposed value" value={change.after} />
          </label>
          {!disabled && (
            <button aria-label={`Remove change ${index + 1}`} className="icon-button remove-change" onClick={() => onChange(changes.filter((_, changeIndex) => changeIndex !== index))} title="Remove change" type="button">
              <Icon name="trash" size={17} />
            </button>
          )}
        </fieldset>
      ))}
    </div>
  );
}
