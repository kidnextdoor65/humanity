import Web3 from "web3";
import fs from "fs";
import config from "./config.js";
import cfonts from "cfonts";
import colors from "colors";
// import readline from 'readline'; // Không cần readline nữa
import axios from "axios";

// --- Các hàm tiện ích ---
function readFileLines(filePath, allowEmpty = false) {
  try {
    if (fs.existsSync(filePath)) {
      const lines = fs
        .readFileSync(filePath, "utf8")
        .split("\n")
        .map((line) => line.trim());
      return allowEmpty ? lines : lines.filter((line) => line !== "");
    }
  } catch (err) {
    console.error(colors.red(`Lỗi đọc file ${filePath}: ${err.message}`));
  }
  return [];
}

// Hàm saveTokensToFile không còn cần thiết nếu script không sửa đổi token.txt
/*
function saveTokensToFile(filePath, tokensArray) {
  // ...
}
*/

function countdown(seconds) {
  return new Promise((resolve) => {
    let remaining = seconds;
    const interval = setInterval(() => {
      const hrs = Math.floor(remaining / 3600);
      const mins = Math.floor((remaining % 3600) / 60);
      const secs = remaining % 60;
      process.stdout.write(
        `\rThời gian đến lần chạy tiếp theo: ${hrs}h ${mins}m ${secs}s `
      );
      remaining--;
      if (remaining < 0) {
        clearInterval(interval);
        process.stdout.write("\n");
        resolve();
      }
    }, 1000);
  });
}

const web3 = new Web3();

// Hàm authenticateAndGetJwt không còn được sử dụng trong luồng này
/*
async function authenticateAndGetJwt(privateKey, dynamicCode) {
  // ...
}
*/

// --- Logic kiểm tra và claim phần thưởng hàng ngày ---
async function checkAndClaimDailyRewardApi(
  privateKey,
  currentJwtForThisAccount,
  accountIndex
) {
  const account = web3.eth.accounts.privateKeyToAccount(privateKey);
  const senderAddress = account.address;
  const jwtTokenToUse = currentJwtForThisAccount;

  if (!jwtTokenToUse) {
    console.log(
      colors.yellow(
        `[${senderAddress}] Không có token trong token.txt cho ví này (dòng ${
          accountIndex + 1
        }). Bỏ qua.`
      )
    );
    return;
  }

  console.log(colors.magenta(`[${senderAddress}] Sử dụng JWT từ token.txt.`));
  // console.log(colors.cyan(`[${senderAddress}] Raw JWT (length ${jwtTokenToUse.length}): -->${jwtTokenToUse}<--`));
  const authorizationHeaderValue = `Bearer ${jwtTokenToUse}`;
  // console.log(colors.cyan(`[${senderAddress}] Authorization header: -->${authorizationHeaderValue}<--`));

  const commonHeaders = {
    authorization: authorizationHeaderValue,
    token: jwtTokenToUse,
    accept: "application/json, text/plain, */*",
    origin: "https://testnet.humanity.org",
    referer: "https://testnet.humanity.org/dashboard",
  };

  try {
    console.log(
      colors.blue(`[${senderAddress}] Đang kiểm tra phần thưởng hàng ngày...`)
    );
    const checkPayload = {}; // QUAN TRỌNG: Xác minh lại request body cho /daily/check
    const checkResponse = await axios.post(
      "https://testnet.humanity.org/api/rewards/daily/check",
      checkPayload,
      { headers: commonHeaders }
    );

    if (checkResponse.data && checkResponse.data.available) {
      console.log(
        colors.green(
          `[${senderAddress}] Phần thưởng có sẵn! Số lượng: ${checkResponse.data.amount}.`
        )
      );
      console.log(colors.blue(`[${senderAddress}] Đang thử claim...`));
      const claimResponse = await axios.post(
        "https://testnet.humanity.org/api/rewards/daily/claim",
        {},
        { headers: commonHeaders }
      );

      if (claimResponse.data && claimResponse.data.daily_claimed) {
        console.log(
          colors.bgGreen(
            colors.black(
              `[${senderAddress}] Claim thành công ${claimResponse.data.amount}!`
            )
          )
        );
      } else {
        console.log(
          colors.yellow(
            `[${senderAddress}] Claim thất bại hoặc đã claim. Message: ${
              claimResponse.data ? claimResponse.data.message : "N/A"
            }`
          )
        );
      }
    } else {
      const message = checkResponse.data
        ? checkResponse.data.message
        : "Không có dữ liệu hoặc không có sẵn.";
      console.log(
        colors.yellow(
          `[${senderAddress}] Phần thưởng không có sẵn. Message: ${message}`
        )
      );
    }
  } catch (error) {
    let errorMessageText = error.message;
    if (error.response) {
      errorMessageText = `Lỗi API (${error.response.status}) khi check/claim: ${
        error.response.data
          ? JSON.stringify(error.response.data)
          : error.message
      }`;
      if (error.response.status === 401) {
        console.warn(
          colors.bgRed(
            `[${senderAddress}] LỖI 401: Token không hợp lệ hoặc đã hết hạn.`
          )
        );
        console.warn(
          colors.yellow(
            `   Vui lòng cập nhật token tại dòng ${
              accountIndex + 1
            } trong token.txt với token mới.`
          )
        );
        // Không còn xóa token tự động nữa:
        // allTokensArrayRef.tokens[accountIndex] = "";
        // allTokensArrayRef.modified = true;
      }
    }
    console.error(
      colors.red(`[${senderAddress}] Lỗi check/claim: ${errorMessageText}`)
    );
  }
}

// --- Hàm chính thực thi ---
async function main() {
  const privateKeysFilePath = config.privateKeysFile || "./private_keys.txt";
  const privateKeys = readFileLines(privateKeysFilePath);

  if (privateKeys.length === 0) {
    console.log(
      colors.red(
        "Không tìm thấy private key nào. Vui lòng kiểm tra file: " +
          privateKeysFilePath
      )
    );
    return;
  }

  const tokenFilePath = config.tokenFilePath || "./token.txt";
  let currentTokens = []; // Sẽ đọc ở mỗi chu kỳ

  while (true) {
    console.log(
      colors.cyan(
        `\n===== Bắt đầu chu kỳ claim mới (${new Date().toLocaleString()}) =====`
      )
    );

    currentTokens = readFileLines(tokenFilePath, true); // Đọc token, cho phép dòng trống
    // Đảm bảo mảng tokens có cùng độ dài với privateKeys, điền chuỗi rỗng nếu thiếu
    while (currentTokens.length < privateKeys.length) {
      currentTokens.push("");
    }
    currentTokens = currentTokens.slice(0, privateKeys.length); // Cắt bớt nếu token.txt nhiều dòng hơn

    const hasAnyEmptyToken = currentTokens.some((token) => !token);
    if (hasAnyEmptyToken) {
      console.log(
        colors.yellow(
          "Cảnh báo: Một số tài khoản đang thiếu token trong " +
            tokenFilePath +
            ". Các tài khoản đó sẽ được bỏ qua."
        )
      );
      console.log(
        colors.cyan(
          "Hãy đảm bảo mỗi private key có một token tương ứng (còn hạn) trong " +
            tokenFilePath +
            "."
        )
      );
    }

    for (let i = 0; i < privateKeys.length; i++) {
      const pk = privateKeys[i];
      const tokenForPk = currentTokens[i] || null; // Lấy token cho PK này, hoặc null

      console.log(
        colors.blue(`\n--- Xử lý ví ${i + 1}/${privateKeys.length} ---`)
      );

      // Hàm checkAndClaimDailyRewardApi không còn cần loginCode nữa
      await checkAndClaimDailyRewardApi(pk, tokenForPk, i);

      if (i < privateKeys.length - 1) {
        const delay = 2000 + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Không còn lưu lại token.txt vì script không sửa đổi nó nữa
    // if (tokensState.modified) {
    //   saveTokensToFile(tokenFilePath, tokensState.tokens);
    // }

    console.log(
      colors.cyan(
        `\n===== Hoàn thành chu kỳ claim. Đợi 24 giờ cho chu kỳ tiếp theo. =====`
      )
    );
    await countdown(24 * 60 * 60);
  }
}

main().catch((error) => {
  console.error(colors.red("LỖI NGHIÊM TRỌNG TRONG QUÁ TRÌNH CHẠY:"), error);
  process.exit(1);
});
