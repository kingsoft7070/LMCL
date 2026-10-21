# 服务器接入接口（草案 v1）

这份接口用于让第三方服务器接入 LMCL，不依赖 LID。当前仅有协议设计和配置原型，尚未实现 HTTP 客户端、服务端或发布工具，字段在首次接入验证后再稳定。

## 用户如何添加

服务器提供一个 HTTPS API 根地址，用户在服务器模式中主动添加。配置格式见 [server-provider.json](../examples/server-provider.json)。公开版默认使用 [空服务器配置](../examples/launcher-settings.json)，不会请求任何服务商接口。

`id` 是本机为接入方分配的稳定标识，修改地址时需要重新确认信任关系。`name` 用于展示；`apiRoot` 不包含令牌、查询参数或片段，以 `/` 结尾；`enabled` 控制是否查询该目录。服务商访问令牌单独存储，不写入可分享配置。

服务器模式只是另一个入口，切换模式不卸载整合包、不切换游戏账户，也不取消下载任务。普通整合包功能不依赖此接口。已安装服务器实例的更新由用户启动/更新该实例的动作触发，不因模式切换自动开始；普通启动也不会自动加入服务器。

## HTTP 接口

下列路径相对于 `apiRoot`。例如根地址为 `https://servers.example.org/lmcl/`，目录请求就是 `GET https://servers.example.org/lmcl/v1/servers`。

| 方法和路径 | 内容 |
| --- | --- |
| `GET v1/servers` | 此接入方提供的服务器目录；返回 `schemaVersion: 1` 和 `servers` 数组 |
| `GET v1/servers/{serverId}/status` | 单个服务器的实时状态；返回与目录中 `status` 相同结构 |
| `GET v1/packs/{packId}/releases/latest?channel=stable` | 指定通道的最新发布；返回下文的包版本引用 |
| `GET v1/packs/{packId}/releases/{releaseId}` | 获取不可变的发布包络，校验后交给通用整合包核心 |

服务商、服务器、包和版本 ID 使用 1–128 位 ASCII 字母、数字、点、下划线或连字符，首位为字母或数字。它们是逻辑标识，不直接作为文件路径。客户端拼接地址时编码路径参数。

返回 JSON，使用 `Content-Type: application/json`。成功返回 `200`；无权访问返回 `401/403`；找不到对象返回 `404`；限流返回 `429` 和 `Retry-After`。错误体使用 `{ "error": { "code": "...", "message": "..." } }`，错误内容不得包含令牌。

## 服务器目录

完整虚构示例见 [server-catalog.json](../examples/server-catalog.json)。

- `id`、`name`：此接入方内的服务器标识与展示名。不同接入方可以使用相同服务器 ID。
- `packId`：关联的客户端整合包。目录本身不携带模组文件或安装脚本。
- `acceptedAccounts`：服务器接受的账户类型，使用 `microsoft`、`littleskin`、`offline`；只是能力声明，不能替代服务端验证。
- `connection`：联机目标 `host` 和 `port`；未开放联机时可为 `null`，端口范围 1–65535。不在这里提供 RCON、SSH 或管理面板权限。
- `status`：见下文。服务目录可以包含维护或暂时离线的注册服务器，UI 可筛选当前在线项目。

服务器模式把服务商目录合并展示，但身份按 `(providerId, serverId)` 隔离；服务器实例按 `(providerId, serverId, packId)` 隔离。普通实例不需要上述任何服务器字段。

## 状态

`state` 使用 `online`、`offline`、`maintenance`、`unknown`。`online` 与 `max` 表示人数和容量，可为非负整数或 `null`；`checkedAt` 为 UTC RFC 3339 时间，尚未检查时为 `null`。

不能把请求失败或超时显示为“在线 0 人”。服务商可声明离线，客户端本身请求失败时应显示未知，并标出旧状态的检查时间。人数统计是否包含假人由服务商说明。

状态查询初步按 30 秒轮询，切换到普通模式停止目录轮询；界面恢复时按检查时间决定是否刷新。限流时按 `Retry-After` 退避。切换模式不是鉴权操作，也不取消用户明确发起的其他任务。

## 包版本引用与发布包络

最新版本返回 `{ "schemaVersion": 1, "packId": "survival-client", "releaseId": "r2", "channel": "stable" }`。具体发布返回 `{ "schemaVersion": 1, "keyId": "...", "payload": "...", "signature": "..." }`。

`payload` 是 Base64 编码的 UTF-8 JSON 原始字节，`signature` 是对这些原始字节的 Ed25519 签名（Base64）。受签名内容必须包含 `schemaVersion`、`packId`、`releaseId`、`channel`、游戏与加载器依赖及文件清单。文件项使用 `path`、`sha256`、`size`、`urls` 和 `policy`；`policy` 可为 `managed` 或 `user-editable`。

完整包络编解码和签名校验尚未实现。未来客户端需要先验证可信公钥及返回的包/版本/通道与请求一致，再调用现有差异计划器；不能直接把网络响应当成可信清单。可信公钥需要在添加接入方时确认，不能从同一份未验证响应中自动信任新密钥。密钥更新、旧版本保留和发布回退检测在正式实现前补齐。

服务器整合包和普通整合包共享实例、下载、校验和更新机制。发布内容必须是经过验证的客户端包；服务端目录改动不直接发布给玩家。

## 私有内容与公开版本

邀请码或访问凭据由接入方自己的服务验证，只授权该接入方的资源，不能充当其他接入方或 Minecraft 游戏账户的凭据。微软、LittleSkin 的原始账户令牌不发送给接入方。跨接入方、跨域重定向和第三方下载地址不自动携带服务商令牌。

LMCL 公开版本只包含通用代码和接口。LID 地址、整合包、素材、访问凭据以及任何专用预设独立维护。用户没有添加服务器时，普通下载、导入整合包、管理实例和启动游戏照常可用。
