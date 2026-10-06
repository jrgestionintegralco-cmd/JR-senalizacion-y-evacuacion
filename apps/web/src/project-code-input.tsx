import { normalizeProjectCode } from './project-code';

export function ProjectCodeInput({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return <input name="code" value={value} required minLength={2} maxLength={40}
    onChange={(event) => {
      const code = normalizeProjectCode(event.currentTarget.value);
      onChange(code);
    }} />;
}
