// Placeholder: the users table has no self-editable columns yet (career fields
// land on the Profile entity in S2-01; password changes go through auth's reset
// flow, never a plain PATCH). PATCH /users/me exists because the frontend's
// settings screen already calls it — add fields here as real columns land.
export class UpdateUserDto {}
