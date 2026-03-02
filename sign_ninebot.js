import axios from "axios";
import moment from "moment";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";

// 初始化环境变量和路径
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: `${__dirname}/.env` });

class NineBot {
    constructor(deviceId, authorization, name = "九号出行") {
        if (!deviceId || !authorization) {
            throw new Error("缺少必要的参数: deviceId 或 authorization");
        }

        this.msg = [];
        this.name = name; // 账号名称（支持自定义）
        this.deviceId = deviceId;
        this.headers = {
            Accept: "application/json, text/plain, */*",
            Authorization: authorization,
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "zh-CN,zh-Hans;q=0.9",
            "Content-Type": "application/json",
            Host: "cn-cbu-gateway.ninebot.com",
            Origin: "https://h5-bj.ninebot.com",
            from_platform_1: "1",
            language: "zh",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Segway v6 C 609033420",
            Referer: "https://h5-bj.ninebot.com/",
        };

        // API端点
        this.endpoints = {
            sign: "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/sign",
            status: "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/status"
        };

        // 请求配置
        this.requestConfig = {
            timeout: 10000,
            retry: 3,
            retryDelay: 2000
        };
    }

    // 带重试机制的请求方法
    async makeRequest(method, url, data = null) {
        let attempts = 0;
        const maxAttempts = this.requestConfig.retry;

        while (attempts < maxAttempts) {
            try {
                console.log(`[${this.name}] 尝试 ${attempts + 1}/${maxAttempts}: ${method} ${url}`);
                const response = await axios({
                    method,
                    url,
                    data,
                    headers: this.headers,
                    timeout: this.requestConfig.timeout
                });

                console.log(`[${this.name}] 请求成功: ${url}`);
                return response.data;
            } catch (error) {
                attempts++;
                console.error(`[${this.name}] 请求失败 (${attempts}/${maxAttempts}):`, error.message);
                if (attempts === maxAttempts) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, this.requestConfig.retryDelay));
            }
        }
    }

    // 执行签到
    async sign() {
        try {
            console.log(`[${this.name}] 开始签到...`);
            const responseData = await this.makeRequest(
                "post",
                this.endpoints.sign,
                { deviceId: this.deviceId }
            );

            if (responseData.code === 0) {
                console.log(`[${this.name}] 签到成功`);
                return true;
            } else {
                const errorMsg = responseData.msg || "未知错误";
                this.msg.push({ name: "签到结果", value: `签到失败: ${errorMsg}` });
                console.error(`[${this.name}] 签到失败:`, errorMsg);
                return false;
            }
        } catch (error) {
            this.handleError("签到", error);
            return false;
        }
    }

    // 验证登录状态并获取签到信息
    async valid() {
        try {
            console.log(`[${this.name}] 验证登录状态并获取签到信息...`);
            const timestamp = moment().valueOf();
            const responseData = await this.makeRequest(
                "get",
                `${this.endpoints.status}?t=${timestamp}`
            );

            if (responseData.code === 0) {
                console.log(`[${this.name}] 验证成功，获取到签到信息`);
                return [responseData.data, ""];
            }
            const errorMsg = responseData.msg || "验证失败";
            console.error(`[${this.name}] 验证失败:`, errorMsg);
            return [false, errorMsg];
        } catch (error) {
            const errorMsg = `登录验证异常: ${this.getErrorMessage(error)}`;
            console.error(`[${this.name}] ${errorMsg}`);
            return [false, errorMsg];
        }
    }

    // 错误处理
    handleError(action, error) {
        const errorMessage = this.getErrorMessage(error);
        console.error(`[${this.name}] ${action}错误:`, errorMessage);
        this.msg.push(
            { name: `${action}结果`, value: `${action}失败` },
            { name: "错误详情", value: errorMessage }
        );
    }

    // 提取错误信息
    getErrorMessage(error) {
        return error.response
            ? `状态码: ${error.response.status}, 信息: ${error.response.data?.msg || error.message}`
            : error.message;
    }

    // 获取日志信息
    get logs() {
        return this.msg.map((one) => `${one.name}: ${one.value}`).join("\n");
    }

    // 运行签到流程
    async run() {
        try {
            console.log(`[${this.name}] 开始执行签到任务...`);
            // 首次获取签到状态
            let [validData, errInfo] = await this.valid();

            if (validData) {
                const completed = validData.currentSignStatus === 1;
                // 记录初始状态
                this.msg.push({
                    name: "连续签到天数",
                    value: `${validData.consecutiveDays || 0}天`,
                });
                this.msg.push({
                    name: "今日签到状态",
                    value: completed ? "已签到🎉" : "未签到❌",
                });

                if (!completed) {
                    // 执行签到
                    const signSuccess = await this.sign();
                    if (signSuccess) {
                        // 签到成功后重新获取最新状态
                        console.log(`[${this.name}] 签到成功，获取最新签到数据...`);
                        const [newValidData] = await this.valid();
                        if (newValidData) {
                            // 更新连续签到天数为最新值
                            this.msg = this.msg.map(item =>
                                item.name === "连续签到天数"
                                    ? { name: "连续签到天数", value: `${newValidData.consecutiveDays || 0}天` }
                                    : item
                            );
                            // 更新今日签到状态
                            this.msg = this.msg.map(item =>
                                item.name === "今日签到状态"
                                    ? { name: "今日签到状态", value: "已签到🎉" }
                                    : item
                            );
                            this.msg.push({ name: "签到结果", value: "签到成功🎉🎉" });
                        } else {
                            this.msg.push({ name: "签到结果", value: "签到成功，但获取最新状态失败" });
                        }
                    }
                } else {
                    console.log(`[${this.name}] 今日已签到，无需重复签到`);
                }
            } else {
                this.msg.push({ name: "验证结果", value: errInfo });
            }
        } catch (error) {
            this.msg.push({ name: "执行结果", value: `执行异常: ${error.message}` });
            console.error(`[${this.name}] 执行异常:`, error);
        } finally {
            console.log(`[${this.name}] 任务执行完成`);
        }
    }
}

// 发送Bark通知（支持完整参数配置）
async function sendBarkNotification(title, message) {
    // 从环境变量获取Bark配置
    const barkUrl = process.env.BARK_URL || "https://api.day.app";
    const barkKey = process.env.BARK_KEY;

    // 没有Bark密钥则不发送
    if (!barkKey) {
        console.log("未配置BARK_KEY，跳过Bark通知");
        return false;
    }

    try {
        // 构建基础URL
        let url = `${barkUrl}/${barkKey}/${encodeURIComponent(title)}/${encodeURIComponent(message)}`;

        // 收集所有可选参数
        const params = [];

        // 通知分组
        if (process.env.BARK_GROUP) {
            params.push(`group=${encodeURIComponent(process.env.BARK_GROUP)}`);
        }

        // 通知图标
        if (process.env.BARK_ICON) {
            params.push(`icon=${encodeURIComponent(process.env.BARK_ICON)}`);
        }

        // 通知铃声
        if (process.env.BARK_SOUND) {
            params.push(`sound=${encodeURIComponent(process.env.BARK_SOUND)}`);
        }

        // 点击跳转URL
        if (process.env.BARK_URL_JUMP) {
            params.push(`url=${encodeURIComponent(process.env.BARK_URL_JUMP)}`);
        }

        // 可复制文本
        if (process.env.BARK_COPY) {
            // 提取连续天数用于替换变量
            const dayMatch = message.match(/连续签到天数: (\d+)天/);
            const day = dayMatch ? dayMatch[1] : "未知";
            const copyText = process.env.BARK_COPY.replace('%day%', day);
            params.push(`copy=${encodeURIComponent(copyText)}`);
        }

        // 自动复制
        if (process.env.BARK_AUTO_COPY === '1') {
            params.push(`autoCopy=1`);
        }

        // 添加参数到URL
        if (params.length > 0) {
            url += `?${params.join('&')}`;
        }

        console.log(`发送Bark通知: ${url}`);

        // 发送请求
        const response = await axios.get(url, { timeout: 5000 });

        if (response.data.code === 200) {
            console.log("Bark通知发送成功");
            return true;
        } else {
            console.error("Bark通知发送失败:", response.data);
            return false;
        }
    } catch (error) {
        console.error("发送Bark通知异常:", error.message);
        return false;
    }
}

// 发送企业微信应用推送
async function sendWeComNotification(title, message) {
    // 从环境变量获取企业微信配置
    const corpId = process.env.WECOM_CORP_ID;         // 企业ID
    const corpSecret = process.env.WECOM_CORP_SECRET;  // 应用Secret
    const agentId = process.env.WECOM_AGENT_ID;        // 应用AgentId
    const toUser = process.env.WECOM_TO_USER || "@all"; // 接收人，默认@all全体
    const proxyUrl = (process.env.WECOM_PROXY_URL || "https://qyapi.weixin.qq.com").replace(/\/+$/, ""); // 代理地址，默认官方API

    // 缺少必要配置则跳过
    if (!corpId || !corpSecret || !agentId) {
        console.log("未配置企业微信应用推送（WECOM_CORP_ID / WECOM_CORP_SECRET / WECOM_AGENT_ID），跳过企业微信通知");
        return false;
    }

    try {
        // 第一步：获取 access_token
        console.log(`企业微信: 正在获取access_token...（API地址: ${proxyUrl}）`);
        const tokenUrl = `${proxyUrl}/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${corpSecret}`;
        const tokenRes = await axios.get(tokenUrl, { timeout: 5000 });

        if (tokenRes.data.errcode !== 0) {
            console.error("企业微信获取access_token失败:", tokenRes.data.errmsg);
            return false;
        }

        const accessToken = tokenRes.data.access_token;
        console.log("企业微信: access_token获取成功");

        // 第二步：构建消息体
        // 判断消息类型：支持文本卡片（textcard）或纯文本（text）
        const msgType = process.env.WECOM_MSG_TYPE || "text"; // 默认文本消息

        let msgBody = {
            touser: toUser,
            agentid: parseInt(agentId),
            safe: 0,
        };

        // 如果配置了发送给指定部门
        if (process.env.WECOM_TO_PARTY) {
            msgBody.toparty = process.env.WECOM_TO_PARTY;
        }

        // 如果配置了发送给指定标签
        if (process.env.WECOM_TO_TAG) {
            msgBody.totag = process.env.WECOM_TO_TAG;
        }

        if (msgType === "textcard") {
            // 文本卡片消息
            msgBody.msgtype = "textcard";
            msgBody.textcard = {
                title: title,
                description: message.replace(/\n/g, "<br>"),
                url: process.env.WECOM_CARD_URL || "https://h5-bj.ninebot.com",
                btntxt: process.env.WECOM_CARD_BTN || "查看详情"
            };
        } else if (msgType === "markdown") {
            // Markdown消息（仅企业微信内部支持，不支持微信插件）
            msgBody.msgtype = "markdown";
            msgBody.markdown = {
                content: `## ${title}\n${message}`
            };
        } else {
            // 默认纯文本消息
            msgBody.msgtype = "text";
            msgBody.text = {
                content: `${title}\n\n${message}`
            };
        }

        // 第三步：发送消息
        const sendUrl = `${proxyUrl}/cgi-bin/message/send?access_token=${accessToken}`;
        console.log("企业微信: 正在发送消息...");
        const sendRes = await axios.post(sendUrl, msgBody, { timeout: 5000 });

        if (sendRes.data.errcode === 0) {
            console.log("企业微信应用推送发送成功");
            return true;
        } else {
            console.error("企业微信应用推送发送失败:", sendRes.data.errmsg);
            return false;
        }
    } catch (error) {
        console.error("发送企业微信通知异常:", error.message);
        return false;
    }
}

// 初始化并执行签到
async function init() {
    // 处理多账号配置
    let accounts = [];
    if (process.env.NINEBOT_ACCOUNTS) {
        try {
            accounts = JSON.parse(process.env.NINEBOT_ACCOUNTS);
            // 为每个账号添加默认名称（如果未配置）
            accounts = accounts.map((acc, index) => ({
                name: acc.name || `账号${index + 1}`, // 默认为"账号1"、"账号2"
                deviceId: acc.deviceId,
                authorization: acc.authorization
            }));
        } catch (e) {
            console.error("NINEBOT_ACCOUNTS 格式错误:", e.message);
            return;
        }
    }
    // 处理单账号配置
    else if (process.env.NINEBOT_DEVICE_ID && process.env.NINEBOT_AUTHORIZATION) {
        accounts.push({
            name: process.env.NINEBOT_NAME || "默认账号", // 支持单账号设置名称
            deviceId: process.env.NINEBOT_DEVICE_ID,
            authorization: process.env.NINEBOT_AUTHORIZATION
        });
    } else {
        console.error("未配置任何账号信息");
        return;
    }

    // 执行所有账号的签到并收集结果
    const allResults = [];
    for (const account of accounts) {
        console.log(`\n===== 开始处理账号: ${account.name} =====`);
        try {
            const bot = new NineBot(account.deviceId, account.authorization, account.name);
            await bot.run();
            allResults.push({
                name: account.name,
                success: bot.logs.includes("签到成功") || bot.logs.includes("已签到"),
                logs: bot.logs
            });
        } catch (e) {
            allResults.push({
                name: account.name,
                success: false,
                logs: `初始化失败: ${e.message}`
            });
        }
    }

    // 生成汇总通知内容
    const title = "九号出行签到结果";
    let message = allResults.map(acc => {
        const status = acc.success ? "✅" : "❌";
        return `${status} ${acc.name}\n${acc.logs.replace(/\n/g, "\n")}`;
    }).join("\n\n");

    // 发送通知（并行发送，互不影响）
    await Promise.allSettled([
        sendBarkNotification(title, message),
        sendWeComNotification(title, message)
    ]);
}

// 启动执行
init();