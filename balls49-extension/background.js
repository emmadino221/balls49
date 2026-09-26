// Background service worker — handles Chrome notifications from content script

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'NOTIFY') return;

    const icons = {
        win:      '🏆',
        loss:     '❌',
        bet:      '🎲',
        stoploss: '🛑',
    };

    chrome.notifications.create(`balls49-${Date.now()}`, {
        type:    'basic',
        iconUrl: 'icon.png',
        title:   msg.title,
        message: msg.message,
        priority: msg.result === 'win' ? 2 : 1,
    });
});