# 开发记录

## 先做什么

先把一个 LID 服务器的流程跑通：查状态、安装客户端整合包、更新、启动游戏。UI 后续按设计稿接入。

下载功能覆盖游戏版本、加载器、模组和整合包。加载器先接 Fabric，再逐步补 Forge、NeoForge 和 Quilt。下载目录和安装流程参考成熟启动器的使用习惯，代码独立实现。

邀请码用于内测权限管理，具体限制哪些下载还没确定。

## 账户

支持微软正版、LittleSkin 和离线三种方式，按这个顺序推荐。登录失败时不能自动切换成离线账户，同名的不同账户也不能自动合并。

LittleSkin 需要处理角色选择、会话刷新和 authlib-injector。网页授权优先考虑 OAuth，设备码登录需要给 LMCL 注册应用并申请白名单。账户令牌放系统凭据存储，密码不落盘。

服务器接受哪种账户由服务器决定，启动器不修改服务器的验证方式。

## 整合包更新

每个服务器关联经过测试的客户端包。服务端的 mods 目录不能直接复制给玩家；服务端改动后，需要先生成并测试新的客户端版本，再发布。

每个服务器使用独立实例。包管理的文件和玩家数据分开，存档、截图、个人设置不能被更新覆盖。只下载新增、变更或缺失的文件，校验完成后再切换版本。游戏还在运行时延后应用。

当前计划器只计算差异，不读写游戏文件。自装模组、受管文件被手动修改、路径冲突等情况会返回冲突，留给后续交互处理。

正式执行器还需要清单签名验证、下载校验、目录锁、暂存、提交和中断恢复。执行前必须重新检查磁盘状态，不能只凭计划结果直接写文件。

## 基岩版

只在 Windows 工具箱中提供打开已安装基岩版的入口，使用系统的 `minecraft://` 协议，不负责安装或更新。尚未做 Windows 真机验证。

## 验证

当前有 14 项自动测试，覆盖账户顺序、离线 UUID、更新差异、配置保留、运行中延后更新，以及 Windows 路径和符号链接冲突。

这些是核心规则测试，不代表已经完成真实账户登录、Windows 游戏启动或安装包测试。

## 参考文档

- [LittleSkin 外置登录](https://manual.littleskin.cn/yggdrasil/)
- [LittleSkin 设备码授权](https://manual.littleskin.cn/advanced/oauth2/device-authorization-grant)
- [authlib-injector 启动器规范](https://yushijinhun.github.io/authlib-injector/en/launcher-technical-specification.html)
- [Modrinth 整合包格式](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack)
- [基岩版协议链接](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/deep-links?view=minecraft-bedrock-stable)
