export interface IUserData {
  bio: string;
  email: string;
  image?: string;
  token: string;
  username: string;
}

export interface IUserRO {
  user: IUserData;
}

export interface IPublicUserData {
  image: string;
  username: string;
}

export interface IPublicUsersRO {
  users: IPublicUserData[];
  usersCount: number;
}
