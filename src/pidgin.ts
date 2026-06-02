/** Replace @username placeholder with the actual Telegram first name. */
export function resolveUsername(template: string, firstName: string): string {
    return template.replace(/@username/g, firstName);
}

/** Simple Pidgin English transformations for key phrases. */
const PIDGIN_MAP: [RegExp, string][] = [
    [/Drop your (IQ Option )?User ID/gi,      'Abeg drop your User ID'],
    [/Enter your (IQ Option )?email/gi,        'Abeg enter your email'],
    [/Enter your password/gi,                  'Enter your password make I link you'],
    [/Let'?s get this money/gi,                'Make we make this money together'],
    [/Create (an?|your) (IQ Option )?account/gi, 'Create account, no be anything'],
    [/Connect your account/gi,                 'Link your account come'],
    [/You're connected/gi,                     'You don enter!'],
    [/Take your first trade/gi,                'Do your first trade now'],
    [/Fund(ing)? (your|the) account/gi,        'Fund your account abeg'],
    [/Reconnect/gi,                            'Connect back abeg'],
    [/Session expired/gi,                      'Your session don expire'],
    [/You\'?re new/gi,                         'You be new person'],
    [/I have traded before/gi,                 'I don trade before'],
    [/Watch the video/gi,                      'Watch the video first'],
];

export function applyPidgin(text: string): string {
    let out = text;
    for (const [pattern, replacement] of PIDGIN_MAP) {
        out = out.replace(pattern, replacement);
    }
    return out;
}
