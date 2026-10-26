import { SETTINGS, type ISettingSpec } from "../../lib/settings";

/** 按分组和「是否高级」取设置项；返回顺序就是设置页的展示顺序 */
export const specsOf = (
  group: ISettingSpec["group"],
  advanced: boolean,
): ISettingSpec[] =>
  SETTINGS.filter(
    (spec) => spec.group === group && Boolean(spec.advanced) === advanced,
  );
