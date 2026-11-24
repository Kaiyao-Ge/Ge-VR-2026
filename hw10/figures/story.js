// HW10 story: the one afternoon that the essay tells and the figures draw. Names, times, board lines and minutes here are the
// same as in the prose of index.html. A classic script: it only assigns HW10.story, and touches no DOM.
// The group (you and four teammates) plans its final project for this VR course in a discussion room, 14:02 to 14:19.
(function () {
   const H = globalThis.HW10 = globalThis.HW10 || {};

   H.story = {
      members: [
         { id: 'you', name: 'Me' },
         { id: 'mia', name: 'Siva' },
         { id: 'ben', name: 'Ben' },
         { id: 'sara', name: 'James' },
         { id: 'tom', name: 'Kaifang' },
      ],

      // Around a table 3 m by 1.2 m centred on [0, 0], in metres (x to the right, y down the page). The whiteboard hangs on the
      // wall at the left end (x = -2.2); its "left" and "right" halves are the halves seen from the table.
      seats: {
         mia: [-1.5, 0],
         you: [-0.5, 0.9],
         ben: [0.5, 0.9],
         tom: [1.5, 0],
         sara: [0, -0.9],
      },

      board: {
         regions: ['left', 'right'],
         versions: [
            { n: 1, t: '14:03', region: 'left',
               lines: ['Final project: ideas', 'A  Lighthouse (2 players)', 'B  Paper city', 'C  Music room'], erased: true },
            { n: 2, t: '14:10', region: 'left',
               lines: ['We pick A: Lighthouse', 'Why: two roles, one room', 'Risk: headset heat'], erased: false },
            { n: 3, t: '14:12', region: 'right',
               lines: ['Who does what', 'Siva: story, sound', 'Ben: levels'], erased: true },
            { n: 4, t: '14:15', region: 'right',
               lines: ['Who does what', 'Siva: story, sound', 'Ben: levels, lamp puzzle', 'James: laptop page', 'Me: hand tracking'], erased: false },
            { n: 5, t: '14:17', region: 'left',
               lines: ['We pick A: Lighthouse', 'Why: two roles, one room', 'Risk: headset heat', 'Playtest: Fri 4 Dec'], erased: false },
         ],
      },

      dialogue: [
         { id: 'd1', t: '14:02', by: 'mia', text: "Let's put three ideas on the board, then pick one.", mentionsYou: false },
         { id: 'd2', t: '14:03', by: 'ben', text: 'I like the Lighthouse. One player in a headset, one at a laptop.', mentionsYou: false },
         { id: 'd3', t: '14:04', by: 'sara', text: "The laptop player needs a map.", mentionsYou: false },
         { id: 'd4', t: '14:06', by: 'you', text: 'Hand tracking is enough for the lamp.', mentionsYou: false },
         { id: 'd5', t: '14:07', by: 'tom', text: 'Paper city is less work, though.', mentionsYou: false },
         { id: 'd6', t: '14:08', by: 'mia', text: 'A headset gets hot after a few minutes, so the rounds must be short.', mentionsYou: false },
         { id: 'd7', t: '14:09', by: 'ben', text: 'Fine. We pick the Lighthouse.', mentionsYou: false },
         { id: 'd8', t: '14:11', by: 'sara', text: 'Who does the story and the sound?', mentionsYou: false },
         { id: 'd9', t: '14:12', by: 'mia', text: 'I will. Ben, can you take the levels?', mentionsYou: false },
         { id: 'd10', t: '14:13', by: 'ben', text: 'Yes, the levels and the lamp puzzle.', mentionsYou: false },
         { id: 'd11', t: '14:14', by: 'tom', text: 'Hand tracking is your part, right?', mentionsYou: true },
         { id: 'd12', t: '14:15', by: 'you', text: 'Yes. I can show the lamp grab by Friday.', mentionsYou: false },
         { id: 'd13', t: '14:15', by: 'sara', text: "I'll make the laptop page, with the map and a hint button, by Tuesday.", mentionsYou: false },
         { id: 'd14', t: '14:17', by: 'mia', text: 'Playtest on Friday the fourth, with three classmates. Everything else by Thursday.', mentionsYou: false },
         { id: 'd15', t: '14:18', by: 'ben', text: 'Open question: can the lab lend us a second headset?', mentionsYou: false },
         { id: 'd16', t: '14:19', by: 'mia', text: "Okay, that's all for today.", mentionsYou: false },
      ],

      // What you are looking at, in order and without gaps. 'laptop' is your own laptop. At 14:14 Kaifang says "your part" while
      // you are on it. At 14:10 you glance at the left half of the board, just as "We pick A" goes up; you never look at the right half.
      attention: {
         you: [
            { from: '14:02', to: '14:03', on: 'mia' },
            { from: '14:03', to: '14:04', on: 'ben' },
            { from: '14:04', to: '14:05', on: 'sara' },
            { from: '14:05', to: '14:07', on: 'board-left' },
            { from: '14:07', to: '14:08', on: 'tom' },
            { from: '14:08', to: '14:09', on: 'mia' },
            { from: '14:09', to: '14:10', on: 'ben' },
            { from: '14:10', to: '14:11', on: 'board-left' },
            { from: '14:11', to: '14:12', on: 'sara' },
            { from: '14:12', to: '14:13', on: 'mia' },
            { from: '14:13', to: '14:15', on: 'laptop' },
            { from: '14:15', to: '14:16', on: 'tom' },
            { from: '14:16', to: '14:17', on: 'sara' },
            { from: '14:17', to: '14:18', on: 'mia' },
            { from: '14:18', to: '14:20', on: 'ben' },
         ],
      },

      minutes: [
         { id: 'm1', kind: 'decision', text: 'Build the Lighthouse game.',
            sources: { dialogue: ['d2', 'd7'], board: [2] } },
         { id: 'm2', kind: 'decision', text: 'Rounds are short because a headset gets hot.',
            sources: { dialogue: ['d6'], board: [2] } },
         { id: 'm3', kind: 'decision', text: 'Playtest on Fri 4 Dec.',
            sources: { dialogue: ['d14'], board: [5] } },
         { id: 'm4', kind: 'action', text: 'Write the story and sound.', owner: 'mia', due: 'Thu 3 Dec',
            sources: { dialogue: ['d8', 'd9', 'd14'], board: [4] } },
         { id: 'm5', kind: 'action', text: 'Build levels and lamp puzzle.', owner: 'ben', due: 'Thu 3 Dec',
            sources: { dialogue: ['d9', 'd10', 'd14'], board: [3, 4] } },
         { id: 'm6', kind: 'action', text: 'Make the laptop page.', owner: 'sara', due: 'Tue 1 Dec',
            sources: { dialogue: ['d3', 'd13'], board: [4] } },
         { id: 'm7', kind: 'action', text: 'Show the hand-tracked lamp grab.', owner: 'you', due: 'Fri 27 Nov',
            sources: { dialogue: ['d11', 'd12'], board: [4] } },
         { id: 'm8', kind: 'open', text: 'Can the lab lend a second headset?',
            sources: { dialogue: ['d15'], board: [] } },
         { id: 'm9', kind: 'open', text: 'Keep Paper city as a fallback?',
            sources: { dialogue: ['d5'], board: [1] } },
      ],
   };
})();
