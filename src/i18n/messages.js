import { englishMessages } from './catalog.js';
import traditional from './zh-TW.json' with { type: 'json' };
import german from './de-DE.json' with { type: 'json' };
import korean from './ko-KR.json' with { type: 'json' };
import spanish from './es-ES.json' with { type: 'json' };
import portuguese from './pt-PT.json' with { type: 'json' };

export const catalogs = Object.freeze({
    'en-US': englishMessages,
    'zh-TW': traditional,
    'de-DE': german,
    'ko-KR': korean,
    'es-ES': spanish,
    'pt-PT': portuguese,
});
