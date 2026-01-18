# Modified Whatsapp-API
<p align='center'>
  <img src="https://files.catbox.moe/rkmw5t.png" width="350">
</p>

--- 

## Usage
```json
"depencies": {
  "@whiskeysockets/baileys": "github: Bealllevey62/xatabail"
}
```
## Import
```javascript
const {
  default:makeWASocket, 
} = require('@whiskeysockets/baileys');
```

```javascript
await Xata.relayMessage(m.chat, {
  productMessage {
    title: "Xatanical",
    description: "Tredict Invictus",
    thumbnail: { url: "./XataThumb" },
    url: "https://t.me/xatanicvxii",
    body: "Buy Access",
    footer: "Footer",
    buttons: [
      {
        name: "cta_url",
        buttonParamsJson: "{\"display_text\":\"Xata.index\",\"url\":\"https://t.me/xatanicvxii\"}"
      }
    ],
    priceAmount1000: 120.000,
    currencyCode: "IDR"
  }
})
```
