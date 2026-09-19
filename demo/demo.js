// Infinite-scroll stand-in: appended posts exercise the extension's MutationObserver.
const FEED = document.getElementById('feed');

const POSTS = [
  {
    title: 'Optimizing Remote Collaboration in Distributed Teams',
    body:
      "In today's fast-paced digital workplace, effective collaboration plays a crucial role " +
      'in organizational success. Furthermore, it is important to note that asynchronous ' +
      'communication enables teams to navigate the complexities of distributed schedules. ' +
      'Additionally, organizations that leverage a holistic approach to documentation can ' +
      'foster a sense of shared ownership. Moreover, a robust framework for meeting hygiene ' +
      'remains a testament to intentional leadership. In conclusion, the landscape of remote ' +
      'work continues to evolve in meaningful and measurable ways.',
    image: 'assets/generated-landscape.png',
    alt: 'AI-generated office illustration'
  },
  {
    title: 'Standup ran long again',
    body:
      'We were supposed to be done in fifteen minutes and somehow spent twenty-two arguing ' +
      'about whether the staging database counts as production. It does not. It also has ' +
      'real customer emails in it, which I pointed out, and then everyone went quiet. Anyway ' +
      "I'm deleting them this afternoon and nobody can stop me. If your test fixtures break, " +
      'that is a feature and I will happily help you rewrite them with fake data.',
    image: 'assets/camera-kitchen.png',
    alt: 'Desk photo taken on a phone'
  }
];

let index = 0;

function addPost() {
  const post = POSTS[index % POSTS.length];
  index += 1;
  const article = document.createElement('article');
  article.className = 'post';
  const heading = document.createElement('h2');
  heading.textContent = post.title;
  const paragraph = document.createElement('p');
  paragraph.textContent = post.body;
  const image = document.createElement('img');
  image.src = post.image;
  image.alt = post.alt;
  article.append(heading, paragraph, image);
  FEED.appendChild(article);
}

document.getElementById('load-more').addEventListener('click', () => {
  addPost();
  addPost();
});
