// The two sides of a contract, as the demo names them to someone playing both: the role bar, the persona switch
// and its toast all read this, so the words never drift apart.
export const ROLE_COPY = {
  client: { side: 'the hirer', does: 'Funds the work and approves the money.' },
  freelancer: { side: 'the freelancer', does: 'Does the work and is paid when the checks pass.' },
}

export const otherRole = (role) => (role === 'client' ? 'freelancer' : 'client')
