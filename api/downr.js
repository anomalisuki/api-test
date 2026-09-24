const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

const CONFIG = {
    baseUrl: "https://downr.org",
    mintEndpoint: "/.netlify/functions/analytics",
    downloadEndpoint: "/.netlify/functions/bbc",
    userAgent:
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
};

module.exports = async (req, res) => {
    if (req.method !== "GET") {
        return res.status(405).json({
            status: false,
            message: "Method Not Allowed"
        });
    }

    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).json({
            status: false,
            message: "Parameter url wajib diisi",
            example: "/api/downr?url=https://example.com/video"
        });
    }

    try {
        const jar = new CookieJar();

        const client = wrapper(
            axios.create({
                jar,
                withCredentials: true,
                headers: {
                    "User-Agent": CONFIG.userAgent,
                    "Accept": "*/*"
                }
            })
        );

        const mintRes = await client.get(
            `${CONFIG.baseUrl}${CONFIG.mintEndpoint}`,
            { timeout: 15000 }
        );

        if (mintRes.status !== 200) {
            return res.status(502).json({
                status: false,
                stage: "mint",
                message: `Gagal minting sesi. HTTP ${mintRes.status}`
            });
        }

        const downloadRes = await client.post(
            `${CONFIG.baseUrl}${CONFIG.downloadEndpoint}`,
            { url: targetUrl },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Origin": CONFIG.baseUrl,
                    "Referer": `${CONFIG.baseUrl}/`
                },
                timeout: 60000
            }
        );

        const data = downloadRes.data;

        if (!data || !data.url) {
            if (
                typeof data === "string" &&
                data.includes("retry")
            ) {
                return res.status(403).json({
                    status: false,
                    stage: "downr",
                    message:
                        "user_retry_required. Session/cookie belum diterima oleh server Downr.",
                    response: data
                });
            }

            return res.status(502).json({
                status: false,
                stage: "downr",
                message: "Data video tidak ditemukan dalam respons.",
                response: data
            });
        }

        return res.status(200).json({
            status: true,
            data
        });

    } catch (err) {
        console.error("Downr API Error:", err);

        if (err.response) {
            const statusCode = err.response.status;
            const responseData = err.response.data;

            if (
                statusCode === 403 &&
                responseData === "user_retry_required"
            ) {
                return res.status(403).json({
                    status: false,
                    stage: "downr",
                    message: "user_retry_required",
                    detail:
                        "Session minting gagal atau cookie tidak terbaca oleh server.",
                    response: responseData
                });
            }

            return res.status(statusCode).json({
                status: false,
                stage: "downr",
                message: "Downr mengembalikan HTTP error.",
                http_status: statusCode,
                response: responseData
            });
        }

        if (err.code === "ECONNABORTED") {
            return res.status(504).json({
                status: false,
                stage: "timeout",
                message: "Request ke Downr timeout."
            });
        }

        return res.status(500).json({
            status: false,
            stage: "server",
            message: err.message || "Internal Server Error"
        });
    }
};
