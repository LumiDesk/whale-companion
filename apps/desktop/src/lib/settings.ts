/**
 * 桌面端只读复用服务端的配置契约。
 *
 * 项目约定“桌面端不 import 服务端源码”，这里是一个显式例外：
 * settings.ts 是纯数据/纯函数，不含 Node API、不读环境变量、不碰 DOM。
 * 这样默认值、范围、控件元数据只有一份，避免两端漂移。
 */
export * from "../../../server/src/settings";
