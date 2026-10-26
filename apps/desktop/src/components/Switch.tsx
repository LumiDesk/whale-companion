interface IProps {
  checked: boolean;
  /** 无障碍名称；视觉上由旁边的标题承担 */
  label: string;
  disabled?: boolean;
  size?: "md" | "sm";
  onChange: (next: boolean) => void;
}

/**
 * 开关：用 button + role=switch，天然支持键盘（空格/回车）。
 * 布尔设置一律用它，别再用复选框。
 */
const Switch = ({
  checked,
  label,
  disabled = false,
  size = "md",
  onChange,
}: IProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className={`switch ${size === "sm" ? "switch-sm" : ""} ${
      checked ? "is-on" : ""
    }`}
    onClick={() => onChange(!checked)}
  >
    <span className="switch-thumb" aria-hidden="true" />
  </button>
);

export default Switch;
