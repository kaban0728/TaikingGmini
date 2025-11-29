document.addEventListener('DOMContentLoaded', () => {
  const historyDiv = document.getElementById('chat-history');
  const inputField = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const exportBtn = document.getElementById('export-btn');
  const reloadBtn = document.getElementById('reload-btn');
  const modelSelect = document.getElementById('model-select');

  const pageInfoContainer = document.getElementById('page-info');
  const pageFavicon = document.getElementById('page-favicon');
  const pageTitle = document.getElementById('page-title');
  const pageUrl = document.getElementById('page-url');

  let currentApiKey = "";

  // 1. APIキー確認
  chrome.storage.local.get(['gemini_api_key'], (result) => {
    if (result.gemini_api_key) {
      currentApiKey = result.gemini_api_key;
    } else if (typeof GEMINI_API_KEY !== 'undefined' && 
             !GEMINI_API_KEY.includes("-----------") && 
             !GEMINI_API_KEY.includes("貼り付けて")) {
      currentApiKey = GEMINI_API_KEY;
    }

    if (!currentApiKey) {
      appendMessage("System", "APIキーが設定されていません。<br>下の入力欄にGoogle AI StudioのAPIキーを貼り付けて送信してください。");
      inputField.placeholder = "APIキーを入力してください (AIza...)";
    }
  });

  let pageContext = "";
  let currentPageUrl = ""; // エクスポートで使用

  // 2. ページ読み込み処理
  function loadCurrentPageContext() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || tabs.length === 0) return;
      
      const tab = tabs[0];
      const tabId = tab.id;
      
      // ★ここでURLを更新するため、リロード後に保存ボタンを押せば最新のURLが使われます
      currentPageUrl = tab.url; 
      
      updatePageInfoUI(tab);

      if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) {
        appendMessage("System", `[${tab.title}]<br>このページの内容は取得できません。`);
        pageContext = "";
        return;
      }

      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      }, () => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
          return;
        }
        chrome.tabs.sendMessage(tabId, { action: "getPageContent" }, (response) => {
          if (!chrome.runtime.lastError && response && response.content) {
            pageContext = response.content;
            if (currentApiKey) {
               appendMessage("System", `"${tab.title}" を読み込みました。`);
            }
          }
        });
      });
    });
  }

  function updatePageInfoUI(tab) {
    pageInfoContainer.style.display = 'flex';
    pageTitle.textContent = tab.title || "No Title";
    pageUrl.textContent = tab.url || "";
    
    if (tab.favIconUrl) {
      pageFavicon.src = tab.favIconUrl;
      pageFavicon.style.display = 'block';
    } else {
      pageFavicon.style.display = 'none';
    }
  }

  // 初期ロード
  loadCurrentPageContext();

  // リロードボタン
  reloadBtn.addEventListener('click', () => {
    appendMessage("System", "ページ情報を更新しています...");
    loadCurrentPageContext();
  });

  // Ctrl+Enter 送信
  inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  // ★ エクスポート処理（リロード後の情報を反映）
  exportBtn.addEventListener('click', () => {
    const messages = historyDiv.querySelectorAll('.message');
    
    if (messages.length === 0) {
      alert("保存する会話履歴がありません。");
      return;
    }

    const now = new Date();
    const dateStr = now.toLocaleString('ja-JP');

    let exportText = `# Gemini Page Chat History\n\n`;
    exportText += `- **Date**: ${dateStr}\n`;
    // ★ pageTitle.textContent と currentPageUrl は loadCurrentPageContext で最新化されています
    exportText += `- **Page**: ${pageTitle.textContent}\n`; 
    exportText += `- **URL**: ${currentPageUrl}\n\n`;
    exportText += `---\n\n`;

    messages.forEach(msgDiv => {
      let text = msgDiv.innerText;
      exportText += `${text}\n\n---\n\n`;
    });

    const blob = new Blob([exportText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    const yyyy = now.getFullYear();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const hh = now.getHours().toString().padStart(2, '0');
    const min = now.getMinutes().toString().padStart(2, '0');
    
    const filename = `gemini_pagechat_${yyyy}${mm}${dd}_${hh}${min}.md`;

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  sendBtn.addEventListener('click', async () => {
    const userInput = inputField.value.trim();
    if (!userInput) return;

    if (!currentApiKey) {
      if (userInput.startsWith("AIza") && userInput.length > 30) {
        chrome.storage.local.set({ gemini_api_key: userInput }, () => {
          currentApiKey = userInput;
          appendMessage("System", "APIキーを登録しました！<br>続けて質問を入力してください。");
          inputField.value = "";
          inputField.placeholder = "質問を入力 (Ctrl+Enterで送信)...";
        });
      } else {
        appendMessage("Error", "無効なAPIキーの形式です。<br>正しいAPIキーを入力してください。");
      }
      return;
    }

    const selectedModel = modelSelect.value;
    
    appendMessage("You", userInput);
    inputField.value = "";
    const loadingId = appendMessage("System", "考え中...");

    try {
      const response = await callGeminiAPI(currentApiKey, userInput, pageContext, selectedModel);
      removeMessage(loadingId);
      appendMessage("Gemini", response);
    } catch (error) {
      removeMessage(loadingId);
      if (error.message.includes("400") || error.message.includes("API key")) {
         appendMessage("Error", "APIエラーが発生しました。APIキーが無効の可能性があります。<br>拡張機能を再読み込みしてキーを再設定してください。");
      } else {
         appendMessage("Error", `エラーが発生しました:\n${error.message}`);
      }
    }
  });

  function appendMessage(sender, text) {
    const div = document.createElement('div');
    const msgId = "msg-" + Date.now() + Math.random();
    div.id = msgId;
    div.className = `message ${sender === 'You' ? 'user' : 'ai'}`;
    
    if (sender === 'System' || sender === 'Error') {
       div.innerHTML = text;
    } else {
       let displayText = text;
       if (sender === 'Gemini') {
         displayText = parseMarkdown(text);
       } else {
         displayText = text.replace(/\n/g, '<br>');
       }
       div.innerHTML = `<strong>${sender}:</strong><br>${displayText}`;
    }

    historyDiv.appendChild(div);
    historyDiv.scrollTop = historyDiv.scrollHeight;
    return msgId;
  }

  function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function parseMarkdown(text) {
    let html = text;
    html = html.replace(/```([\s\S]*?)```/g, '<pre style="background:#eee;padding:5px;border-radius:4px;"><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code style="background:#eee;padding:2px 4px;border-radius:3px;">$1</code>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    html = html.replace(/^[\*\-] (.*)$/gm, '・$1');
    html = html.replace(/^### (.*)$/gm, '<strong>$1</strong>');
    html = html.replace(/^## (.*)$/gm, '<h4 style="margin:5px 0;">$1</h4>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  async function callGeminiAPI(key, prompt, context, modelType) {
    let modelName = 'gemini-2.5-flash'; 
    if (modelType === 'pro') {
      modelName = 'gemini-2.5-pro'; 
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;
    
    const requestBody = {
      contents: [{
        parts: [
          { text: `以下のWebページの内容に基づいて答えてください。\n\n[ページ内容]: ${context}\n\n[ユーザーの質問]: ${prompt}` }
        ]
      }]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    
    if (data.error) {
      console.error("Gemini API Error:", data.error);
      const errorMsg = `Code: ${data.error.code}\nMessage: ${data.error.message}`;
      throw new Error(errorMsg);
    }
    
    if (!data.candidates || data.candidates.length === 0) {
       throw new Error("応答が空でした。");
    }

    return data.candidates[0].content.parts[0].text;
  }
});